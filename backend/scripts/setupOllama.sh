#!/bin/bash
echo "[SENTRI] Pulling base models..."
ollama pull phi3:mini
ollama pull mistral:7b

echo "[SENTRI] Building SENTRI-tuned models..."
ollama create sentri-classifier -f ./backend/ollama/SENTRIClassifier.Modelfile
ollama create sentri-analyzer   -f ./backend/ollama/SENTRIAnalyzer.Modelfile

echo "[SENTRI] Verifying models..."
ollama list | grep sentri

echo "[SENTRI] Model setup complete."
