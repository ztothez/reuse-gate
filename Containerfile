FROM registry.access.redhat.com/ubi9/python-312:latest
WORKDIR /opt/app-root/src
COPY --chown=1001:0 *.py *.json estate.db ./
RUN chmod -R g=u /opt/app-root/src
USER 1001
ENV PORT=8080 DB_PATH=estate.db
EXPOSE 8080
CMD ["sh", "-c", "python3 server.py ${DB_PATH} ${PORT}"]
