FROM python:3.12-slim
ARG CACHE_BUST=2
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-urd tesseract-ocr-ara git curl build-essential libpq-dev libportaudio2 && rm -rf /var/lib/apt/lists/*
ENV REFERENCE_OCR_ENGINE=tesseract
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && pip install --no-cache-dir -r requirements.txt
RUN pip install --no-cache-dir absl-py flatbuffers matplotlib sounddevice && pip install --no-cache-dir --no-deps mediapipe==0.10.32 && mkdir -p /app/models \
    && curl --fail --silent --show-error --location --retry 3 \
       https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite \
       --output /app/models/yamnet.tflite
COPY . .
RUN mkdir -p uploads
EXPOSE 8000

CMD ["python", "-m", "app.main"]
