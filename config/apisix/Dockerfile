FROM apache/apisix:3.8.0-debian

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl coreutils \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=apisix:apisix config/apisix/assurance-apisix-entrypoint.sh /usr/local/bin/assurance-apisix-entrypoint.sh
RUN chmod 0755 /usr/local/bin/assurance-apisix-entrypoint.sh

USER apisix
ENTRYPOINT ["/usr/local/bin/assurance-apisix-entrypoint.sh"]
CMD ["docker-start"]
