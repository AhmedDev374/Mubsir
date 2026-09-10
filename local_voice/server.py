import asyncio
import base64
import json
import os
import signal
import sys
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import websockets
from websockets.server import WebSocketServerProtocol

try:
    from faster_whisper import WhisperModel
except Exception:  # pragma: no cover
    WhisperModel = None

try:
    import soundfile as sf
    import torch
    from kokoro import KModel
except Exception:  # pragma: no cover
    KModel = None
    torch = None
    sf = None


ROOT = Path(__file__).resolve().parent
MODELS_DIR = ROOT / 'models'
MODEL_CACHE = MODELS_DIR / 'cache'
MODELS_DIR.mkdir(parents=True, exist_ok=True)
MODEL_CACHE.mkdir(parents=True, exist_ok=True)
KEMETONE_DIR = MODELS_DIR / 'tts' / 'Rabe3-kemetone'


class LocalVoiceService:
    def __init__(self) -> None:
        self.model: Any | None = None
        self.kemetone: Any | None = None
        self.kemetone_voice: Any | None = None
        self.kemetone_g2p: Any | None = None
        # Tiny models download quickly and are enough to verify the local offline path.
        self.model_name = os.environ.get('MUBSIR_WHISPER_MODEL', 'tiny')
        self.ready = False
        self.clients: set[WebSocketServerProtocol] = set()
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if WhisperModel is None:
            await self.broadcast({
                'type': 'error',
                'error': {
                    'code': 'stt-unavailable',
                    'message': 'Local speech recognition is not installed. Run: pip install -r local_voice/requirements.txt'
                }
            })
            return
        try:
            device = 'cuda' if self._cuda_available() else 'cpu'
            compute_type = 'int8_float16' if device == 'cuda' else 'int8'
            self.model = WhisperModel(
                self.model_name,
                device=device,
                compute_type=compute_type,
                download_root=str(MODELS_DIR),
            )
            self.ready = True
            await self.broadcast({'type': 'service.ready', 'device': device, 'model': self.model_name})
        except Exception as exc:  # pragma: no cover
            await self.broadcast({'type': 'error', 'error': {'code': 'stt-load-failed', 'message': str(exc)}})

    def _cuda_available(self) -> bool:
        try:
            import torch
            return bool(torch.cuda.is_available())
        except Exception:
            return False

    async def broadcast(self, payload: dict[str, Any]) -> None:
        frame = json.dumps(payload)
        dead: list[WebSocketServerProtocol] = []
        for client in list(self.clients):
            try:
                await client.send(frame)
            except Exception:
                dead.append(client)
        for client in dead:
            self.clients.discard(client)

    async def handle_client(self, websocket: WebSocketServerProtocol) -> None:
        self.clients.add(websocket)
        print('[local voice] WebSocket connected', flush=True)
        try:
            async for raw in websocket:
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                message_type = payload.get('type')
                print(f'[local voice] message received: {message_type}', flush=True)
                if message_type == 'session.start':
                    await self._send_session_ready(websocket, payload)
                elif message_type == 'transcription.start':
                    await self._on_transcription(websocket, payload)
                elif message_type == 'tts.synthesize':
                    await self._on_tts(websocket, payload)
                elif message_type == 'response.create':
                    await websocket.send(json.dumps({'type': 'response.started', 'ok': True}))
                elif message_type == 'response.cancel':
                    await websocket.send(json.dumps({'type': 'interrupted', 'ok': True}))
                elif message_type == 'ping':
                    await websocket.send(json.dumps({'type': 'pong'}))
        finally:
            self.clients.discard(websocket)
            print('[local voice] WebSocket disconnected', flush=True)

    async def _send_session_ready(self, websocket: WebSocketServerProtocol, payload: dict[str, Any]) -> None:
        await websocket.send(json.dumps({
            'type': 'session.ready',
            'provider': 'local',
            'mode': 'voice',
            'device': 'cuda' if self._cuda_available() else 'cpu',
            'model': self.model_name,
            'instructions': payload.get('instructions', 'You are MUBSIR. Answer based on the open document.'),
        }))

    async def _on_transcription(self, websocket: WebSocketServerProtocol, payload: dict[str, Any]) -> None:
        if self.model is None:
            await websocket.send(json.dumps({'type': 'error', 'error': {'code': 'stt-unavailable', 'message': 'Speech recognition is not available.'}}))
            return
        audio_data = payload.get('audio')
        sample_rate = int(payload.get('sample_rate', 16000))
        if audio_data is None:
            await websocket.send(json.dumps({'type': 'error', 'error': {'code': 'audio-missing', 'message': 'No microphone audio was provided.'}}))
            return
        try:
            if payload.get('audio_encoding') == 'float32-le-base64':
                audio = np.frombuffer(base64.b64decode(audio_data), dtype='<f4')
            else:
                audio = np.frombuffer(bytes(audio_data), dtype=np.float32)
            if audio.size == 0:
                raise ValueError('The microphone payload contained no samples.')
            print(f'[local voice] STT started: {audio.size} samples at {sample_rate} Hz', flush=True)
            segments, _ = self.model.transcribe(audio, beam_size=5, language=payload.get('language'))
            transcript = ' '.join(part.text for part in segments).strip()
            print(f'[local voice] STT completed: {len(transcript)} characters', flush=True)
            await websocket.send(json.dumps({
                'type': 'transcription.final',
                'text': transcript,
                'language': payload.get('language', 'auto')
            }))
        except Exception as exc:  # pragma: no cover
            await websocket.send(json.dumps({'type': 'error', 'error': {'code': 'transcription-failed', 'message': str(exc)}}))

    def _load_kemetone(self) -> None:
        if self.kemetone is not None:
            return
        if KModel is None or torch is None:
            raise RuntimeError('KemeTone dependencies are not installed. Run: pip install -r local_voice/requirements.txt')
        if not (KEMETONE_DIR / 'kemetone.pth').is_file():
            raise RuntimeError('KemeTone model is not installed. Run: npm run dev')
        sys.path.insert(0, str(KEMETONE_DIR))
        from kemetone import EgyptianG2P

        self.kemetone_g2p = EgyptianG2P()
        self.kemetone = KModel(
            repo_id=str(KEMETONE_DIR),
            config='config.json',
            model='kemetone.pth'
        ).eval()
        self.kemetone_voice = torch.load(KEMETONE_DIR / 'voices' / 'kemetone.pt', map_location='cpu')

    async def _on_tts(self, websocket: WebSocketServerProtocol, payload: dict[str, Any]) -> None:
        request_id = str(payload.get('request_id', ''))
        text = str(payload.get('text', '')).strip()
        if not text:
            await websocket.send(json.dumps({'type': 'tts.error', 'request_id': request_id, 'message': 'No text to speak.'}))
            return
        try:
            self._load_kemetone()
            ipa = self.kemetone_g2p(text)
            audio = self.kemetone(ipa, self.kemetone_voice[len(ipa) - 1]).detach().cpu().numpy().astype('float32')
            encoded = base64.b64encode(audio.tobytes()).decode('ascii')
            await websocket.send(json.dumps({
                'type': 'tts.audio',
                'request_id': request_id,
                'audio': encoded,
                'audio_encoding': 'float32-le-base64',
                'sample_rate': 24000
            }))
        except Exception as exc:
            await websocket.send(json.dumps({'type': 'tts.error', 'request_id': request_id, 'message': str(exc)}))


async def main() -> None:
    service = LocalVoiceService()
    await service.start()
    async with websockets.serve(service.handle_client, '127.0.0.1', 8765, ping_interval=None):
        print('MUBSIR local voice service running on ws://127.0.0.1:8765/ws/voice', flush=True)
        await asyncio.Future()


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print('Local voice service shut down.', flush=True)
        sys.exit(0)
