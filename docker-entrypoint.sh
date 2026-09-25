#!/bin/sh
set -eu

# The deployment volume may be initialized with the base Nginx image's default
# index.html. Use our own marker so that the checked-in Mainsite bundle is
# seeded exactly once; later Sitemaster publishes replace generated pages in
# this same volume.
if [ ! -f /usr/share/nginx/html/.mainsite-seeded ]; then
  find /usr/share/nginx/html -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -R /opt/mainsite-seed/. /usr/share/nginx/html/
  touch /usr/share/nginx/html/.mainsite-seeded
fi

# Sitemaster runs as the unprivileged Node user and writes to this shared
# deployment volume. Nginx starts as root, so grant that user ownership before
# handing control to Nginx.
chown -R 1000:1000 /usr/share/nginx/html

exec "$@"
