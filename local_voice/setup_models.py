"""Ensure the local model files required by MUBSIR are present on disk."""

from pathlib import Path
import os
import shutil
import sys

from huggingface_hub import hf_hub_download


ROOT = Path(__file__).resolve().parent
MODELS = ROOT / "models"

MODEL_FILES = {
    "llm/LFM2.5-1.2B-Instruct-ONNX": (
        "LiquidAI/LFM2.5-1.2B-Instruct-ONNX",
        (
            "config.json",
            "generation_config.json",
            "tokenizer_config.json",
            "tokenizer.json",
            "onnx/model_q4f16.onnx",
            "onnx/model_q4f16.onnx_data",
        ),
    ),
    "tts/Supertone-supertonic-3": (
        "Supertone/supertonic-3",
        (
            "onnx/tts.json",
            "onnx/unicode_indexer.json",
            "onnx/duration_predictor.onnx",
            "onnx/text_encoder.onnx",
            "onnx/vector_estimator.onnx",
            "onnx/vocoder.onnx",
            *(f"voice_styles/{voice}.json" for voice in ("F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5")),
        ),
    ),
    "tts/Rabe3-kemetone": (
        "Rabe3/kemetone",
        (
            "config.json",
            "kemetone.pth",
            "voices/kemetone.pt",
            "kemetone/__init__.py",
            "kemetone/arabic.py",
            "kemetone/g2p.py",
            "kemetone/normalize_tashkeel.py",
            "kemetone/runtime.py",
            "kemetone/lexicons/ث.tsv",
            "kemetone/lexicons/ذ.tsv",
            "kemetone/lexicons/ظ.tsv",
            "kemetone/lexicons/ق.tsv",
        ),
    ),
}


def ensure_model(name: str, repo: str, files: tuple[str, ...]) -> None:
    target = MODELS / name
    target.mkdir(parents=True, exist_ok=True)
    missing = [file for file in files if not (target / file).is_file()]
    if not missing:
        print(f"[local models] {name}: ready")
        return

    print(f"[local models] {name}: downloading {len(missing)} missing files", flush=True)
    for file in missing:
        downloaded = Path(
            hf_hub_download(repo_id=repo, filename=file, local_dir=str(target))
        )
        destination = target / file
        destination.parent.mkdir(parents=True, exist_ok=True)
        if downloaded.resolve() != destination.resolve():
            shutil.copyfile(downloaded, destination)
        print(f"[local models] {name}: {file} ready", flush=True)


def main() -> int:
    try:
        for name, (repo, files) in MODEL_FILES.items():
            ensure_model(name, repo, tuple(files))
    except Exception as error:
        print(f"[local models] setup failed: {error}", file=sys.stderr)
        return 1
    print("[local models] all required models are ready", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())