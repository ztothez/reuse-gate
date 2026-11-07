FROM registry.access.redhat.com/ubi9/python-312:latest
WORKDIR /opt/app-root/src
COPY --chown=1001:0 backend backend
COPY --chown=1001:0 scripts scripts
COPY --chown=1001:0 data/estate.db data/catalog.json data/cases.example.jsonl data/mock_api.json data/
RUN chmod -R g=u /opt/app-root/src
USER 1001
ENV PORT=8080 DB_PATH=data/estate.db PYTHONPATH=/opt/app-root/src/backend
EXPOSE 8080
CMD ["sh", "-c", "python3 -m reuse_gate.server ${DB_PATH} ${PORT}"]
