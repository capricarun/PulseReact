#!/bin/bash
# MySQL "initdb" hook: runs ONCE, when the data directory is empty (first start of the StatefulSet).
# The official mysql image sources this file after 01-schema.sql has created the database and tables.
# It creates the least-privilege application user (read/write data only; no DROP/ALTER/GRANT).
# DB_USER / DB_NAME come from the ConfigMap and DB_PASSWORD from the Kubernetes Secret - nothing is hardcoded.
# Note: this file is sourced by the entrypoint, so do not add "set -u" or "exit" here.

: "${DB_USER:?DB_USER must be set}"
: "${DB_PASSWORD:?DB_PASSWORD must be set}"
: "${DB_NAME:?DB_NAME must be set}"

mysql_note "Creating application user '${DB_USER}' with SELECT/INSERT/UPDATE/DELETE on ${DB_NAME}.*"

docker_process_sql --database=mysql <<EOSQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB_NAME}\`.* TO '${DB_USER}'@'%';
FLUSH PRIVILEGES;
EOSQL
