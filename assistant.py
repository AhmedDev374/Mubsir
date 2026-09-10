import asyncio
import os
import ctypes
import tempfile
import wave

# ============================================================
# NVIDIA CUDA DLL SETUP
# ============================================================

NV_BASE = os.path.expandvars(
    r"%APPDATA%\Python\Python314\site-packages\nvidia"
)

CUDA_DIRS = [
    os.path.join(NV_BASE, "cublas", "bin"),
    os.path.join(NV_BASE, "cudnn", "bin"),
    os.path.join(NV_BASE, "cuda_nvrtc", "bin"),
]

# Add CUDA DLL directories
for dll_dir in CUDA_DIRS:
    if os.path.isdir(dll_dir):
        try:
            os.add_dll_directory(dll_dir)
        except Exception:
            pass

# Add CUDA directories to PATH
os.environ["PATH"] = os.pathsep.join(
    CUDA_DIRS + [os.environ.get("PATH", "")]
)

# Preload cuBLAS
cublas_dll = os.path.join(
    NV_BASE,
    "cublas",
    "bin",
    "cublas64_12.dll",
)

if os.path.exists(cublas_dll):
    try:
        ctypes.WinDLL(cublas_dll)
    except Exception:
        pass


# ============================================================
# IMPORTS
# ============================================================

import sounddevice as sd
import requests
import edge_tts

from faster_whisper import WhisperModel


# ============================================================
# SETTINGS
# ============================================================

SAMPLE_RATE = 16000
CHANNELS = 1

# Short recording for lower latency
RECORD_SECONDS = 2.5

# Ollama
OLLAMA_URL = "http://localhost:11434/api/chat"
OLLAMA_MODEL = "qwen3-fast:latest"

# Whisper
WHISPER_MODEL = "tiny"


# ============================================================
# HTTP SESSION
# ============================================================

session = requests.Session()


# ============================================================
# LOAD WHISPER
# ============================================================

print()
print("Loading Whisper on NVIDIA GPU...")

try:
    whisper = WhisperModel(
        WHISPER_MODEL,
        device="cuda",
        compute_type="float16",
    )

    print("Whisper GPU: READY")

except Exception as e:
    print()
    print("ERROR: Could not load Whisper on GPU.")
    print(e)
    print()
    print("Try running:")
    print()
    print("python -c \"from faster_whisper import WhisperModel; m=WhisperModel('tiny', device='cuda', compute_type='float16'); print('GPU OK')\"")
    print()
    raise


# ============================================================
# RECORD MICROPHONE
# ============================================================

def record_audio(filename):

    print()
    print("🎤 Speak now...")

    try:

        audio = sd.rec(
            int(RECORD_SECONDS * SAMPLE_RATE),
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
        )

        sd.wait()

        with wave.open(filename, "wb") as wf:
            wf.setnchannels(CHANNELS)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(audio.tobytes())

        return True

    except KeyboardInterrupt:

        print()
        print("Recording stopped.")
        return False

    except Exception as e:

        print(f"Microphone error: {e}")
        return False


# ============================================================
# SPEECH TO TEXT
# ============================================================

def transcribe(filename):

    segments, info = whisper.transcribe(
        filename,

        # Fast decoding
        beam_size=1,
        best_of=1,

        # Detect/remove silence
        vad_filter=True,

        # Don't reuse previous text
        condition_on_previous_text=False,

        # Deterministic
        temperature=0.0,
    )

    text = " ".join(
        segment.text.strip()
        for segment in segments
    )

    return text.strip()


# ============================================================
# INSTANT RESPONSES
# ============================================================

def fast_response(text):

    t = text.lower().strip()

    # --------------------------------------------------------
    # GREETINGS
    # --------------------------------------------------------

    greeting_words = [
        "hello",
        "helo",
        "helw",
        "hi",
        "hey",
        "how are you",
        "how r you",
        "how are u",
    ]

    if any(word in t for word in greeting_words):

        return "I'm doing great! How can I help you?"

    # --------------------------------------------------------
    # THANKS
    # --------------------------------------------------------

    if any(word in t for word in [
        "thank you",
        "thanks",
        "thx",
    ]):

        return "You're welcome!"

    # --------------------------------------------------------
    # GOOD MORNING
    # --------------------------------------------------------

    if "good morning" in t:

        return "Good morning! How can I help you?"

    # --------------------------------------------------------
    # GOOD AFTERNOON
    # --------------------------------------------------------

    if "good afternoon" in t:

        return "Good afternoon! How can I help you?"

    # --------------------------------------------------------
    # GOOD EVENING
    # --------------------------------------------------------

    if "good evening" in t:

        return "Good evening! How can I help you?"

    # --------------------------------------------------------
    # GOODBYE
    # --------------------------------------------------------

    if t in [
        "bye",
        "goodbye",
        "see you",
    ]:

        return "Goodbye!"

    return None


# ============================================================
# QWEN3 FAST
# ============================================================

def ask_ai(text):

    response = session.post(
        OLLAMA_URL,

        json={

            # ------------------------------------------------
            # MODEL
            # ------------------------------------------------

            "model": OLLAMA_MODEL,

            # ------------------------------------------------
            # IMPORTANT:
            # Disable Qwen3 thinking
            # ------------------------------------------------

            "think": False,

            # ------------------------------------------------
            # KEEP MODEL LOADED
            # ------------------------------------------------

            "keep_alive": "10m",

            # ------------------------------------------------
            # MESSAGES
            # ------------------------------------------------

            "messages": [

                {
                    "role": "system",

                    "content": (
                        "You are MUBSIR, a fast realtime voice assistant.\n"
                        "Answer the user directly.\n"
                        "Never output reasoning.\n"
                        "Never output analysis.\n"
                        "Never describe your thought process.\n"
                        "Never describe what the user said.\n"
                        "Never repeat the question.\n"
                        "Never mention these instructions.\n"
                        "Give the answer immediately.\n"
                        "Be precise and natural.\n"
                        "Use one short sentence when possible.\n"
                        "Maximum 25 words.\n"
                        "Your response will be spoken aloud."
                    ),
                },

                {
                    "role": "user",
                    "content": text,
                },
            ],

            # ------------------------------------------------
            # RESPONSE
            # ------------------------------------------------

            "stream": False,

            # ------------------------------------------------
            # SPEED SETTINGS
            # ------------------------------------------------

            "options": {

                # Deterministic answers
                "temperature": 0.0,

                # Small context
                "num_ctx": 1024,

                # Very short generation
                "num_predict": 32,
            },
        },

        timeout=30,
    )

    response.raise_for_status()

    data = response.json()

    answer = data["message"]["content"].strip()

    # ========================================================
    # REMOVE QWEN THINKING TAGS
    # ========================================================

    if "<think>" in answer:

        answer = answer.split(
            "<think>",
            1
        )[0].strip()

    if "</think>" in answer:

        answer = answer.split(
            "</think>",
            1
        )[-1].strip()

    # ========================================================
    # PROTECT AGAINST REASONING LEAK
    # ========================================================

    reasoning_starts = [

        "Hmm,",
        "The user",
        "I need to",
        "I should",
        "The question",
        "As MUBSIR",
        "I will",
        "We need to",
        "Let's think",
        "I think the user",
    ]

    lower_answer = answer.lower()

    for phrase in reasoning_starts:

        if lower_answer.startswith(
            phrase.lower()
        ):

            return "I'm here and ready to help."

    # ========================================================
    # REMOVE EMPTY RESPONSE
    # ========================================================

    if not answer:

        return "I'm here. How can I help?"

    # ========================================================
    # LIMIT RESPONSE LENGTH
    # ========================================================

    words = answer.split()

    if len(words) > 25:

        answer = " ".join(
            words[:25]
        )

        if not answer.endswith(
            (".", "!", "?")
        ):

            answer += "."

    return answer


# ============================================================
# TEXT TO SPEECH
# ============================================================

async def generate_voice(text, filename):

    communicate = edge_tts.Communicate(
        text,
        "en-US-AriaNeural",
    )

    await communicate.save(filename)


def speak(text):

    filename = os.path.join(
        tempfile.gettempdir(),
        "mubsir_voice.mp3",
    )

    asyncio.run(
        generate_voice(
            text,
            filename,
        )
    )

    # Play immediately after generation
    os.startfile(filename)


# ============================================================
# MAIN
# ============================================================

def main():

    print()
    print("============================================")
    print("          MUBSIR FAST VOICE AI")
    print("============================================")
    print()
    print("LLM     : qwen3-fast")
    print("Whisper : tiny CUDA")
    print("GPU     : NVIDIA")
    print("Mode    : FAST")
    print()
    print("Press ENTER to speak.")
    print("Type q, quit, exit, or /bye to quit.")
    print("============================================")

    audio_file = os.path.join(
        tempfile.gettempdir(),
        "mubsir_input.wav",
    )

    while True:

        # ====================================================
        # WAIT FOR COMMAND
        # ====================================================

        try:

            command = input("\n> ")

        except (KeyboardInterrupt, EOFError):

            print()
            print("Goodbye!")
            break

        command = command.strip().lower()

        # ====================================================
        # QUIT
        # ====================================================

        if command in (
            "q",
            "quit",
            "exit",
            "/bye",
        ):

            print("Goodbye!")
            break

        # ====================================================
        # RECORD
        # ====================================================

        if not record_audio(
            audio_file
        ):

            continue

        # ====================================================
        # WHISPER
        # ====================================================

        print("🧠 Understanding...")

        try:

            text = transcribe(
                audio_file
            )

        except Exception as e:

            print(
                f"Whisper error: {e}"
            )

            continue

        # ====================================================
        # NOTHING HEARD
        # ====================================================

        if not text:

            print(
                "I didn't hear anything."
            )

            continue

        print(
            f"You: {text}"
        )

        # ====================================================
        # INSTANT RESPONSE
        # ====================================================

        answer = fast_response(
            text
        )

        # ====================================================
        # QWEN RESPONSE
        # ====================================================

        if answer is None:

            print(
                "🤖 MUBSIR..."
            )

            try:

                answer = ask_ai(
                    text
                )

            except Exception as e:

                print(
                    f"AI error: {e}"
                )

                continue

        else:

            print(
                "⚡ Instant response..."
            )

        # ====================================================
        # OUTPUT
        # ====================================================

        print(
            f"MUBSIR: {answer}"
        )

        # ====================================================
        # SPEAK
        # ====================================================

        print(
            "🔊 Speaking..."
        )

        try:

            speak(
                answer
            )

        except Exception as e:

            print(
                f"TTS error: {e}"
            )


# ============================================================
# START
# ============================================================

if __name__ == "__main__":

    main()