FROM python:3.12-alpine
WORKDIR /preview
COPY index.html .
COPY dashboard/ ./dashboard/
EXPOSE 8080
CMD ["python3","-m","http.server","8080","--bind","0.0.0.0"]
