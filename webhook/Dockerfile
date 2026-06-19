FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
WORKDIR /webhook
COPY server.py .
CMD ["python", "-u", "server.py"]
