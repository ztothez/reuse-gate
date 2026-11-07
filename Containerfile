FROM registry.access.redhat.com/ubi9/python-312:latest
WORKDIR /opt/app-root/src
COPY --chown=1001:0 backend backend
COPY --chown=1001:0 scripts scripts
# Runtime: estate.db (the data pack, read-only), catalog.json, prewarmed_answers.json (saved chip answers), evaluation.json (GET /evaluation).
# Gates and scripts in the image: messy_requests.jsonl, judge_prompt.txt, gold_labels_template.csv, cases.example.jsonl, mock_api.json, docs/eval_report.json.
# Work item samples are built from estate.db at startup, so they need no file.
COPY --chown=1001:0 data/estate.db data/catalog.json data/cases.example.jsonl data/mock_api.json data/prewarmed_answers.json data/evaluation.json data/messy_requests.jsonl data/judge_prompt.txt data/gold_labels_template.csv data/
COPY --chown=1001:0 docs/eval_report.json docs/
RUN chmod -R g=u /opt/app-root/src
USER 1001
ENV PORT=8080 DB_PATH=data/estate.db PYTHONPATH=/opt/app-root/src/backend PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["sh", "-c", "python3 -m reuse_gate.server ${DB_PATH} ${PORT}"]
