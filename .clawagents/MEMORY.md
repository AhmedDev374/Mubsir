## MUBSIR Voice Assistant Architecture & Project Context

### Hardware & Environment Specifications
- **CPU**: Intel Core i7-9750H (6 cores, 12 threads)
- **RAM**: 16 GB
- **GPU**: NVIDIA Quadro T1000 (4 GB VRAM) with CUDA support
- **OS / Runtime**: Windows, Python 3.x, Node/TypeScript (Svelte UI)
- **Constraint**: Strict VRAM and compute budget (4 GB GPU memory); prioritize lightweight models (e.g., `faster-whisper` tiny/small with float16/int8, Ollama lightweight models).

### Core Stack & Integrations
- **Speech-to-Text (STT)**: `faster-whisper` (support for English, Arabic, Egyptian Arabic; CUDA float16 with CPU INT8 fallback).
- **LLM / Reasoning**: Local Ollama instance using `qwen3-fast:latest`.
- **Text-to-Speech (TTS)**:
  - `edge-tts` (already present in `assistant.py`).
  - Local Egyptian Arabic option: `Rabe3/kemetone` (~82M parameters, 24 kHz) with native `EgyptianG2P` and `espeak-ng`.
- **RAG & Document Intelligence**: Local vector/RAG pipeline for uploaded books/PDFs (PyMuPDF, sentence embeddings, FAISS/cosine search) to support grounded Q&A and passage highlighting in the reader.
- **Audio Capture & Controls**: `sounddevice`, hold-to-talk / push-to-talk, silence/VAD detection, and barge-in / interruption support (stopping playback immediately upon new user speech).

### Integration Guidelines
- Reuse and build upon the working reference implementation in `assistant.py`.
- Do not rebuild the MUBSIR reader, UI, or document management from scratch.
- Integrate the voice service modularly (e.g., via WebSocket / localhost communication between frontend Svelte/TS and Python voice/RAG backend).
- Ensure zero hardcoded cloud API dependencies (fully functional offline/local).
