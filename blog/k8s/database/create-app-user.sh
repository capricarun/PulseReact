#!/bin/bash

# Create the least-privilege application user.
# DB_USER, DB_PASSWORD and DB_NAME are supplied by Docker Compose.

: "${DB_USER:?DB_USER must be set}"
: "${DB_PASSWORD:?DB_PASSWORD must be set}"
: "${DB_NAME:?DB_NAME must be set}"
: "${MYSQL_ROOT_PASSWORD:?MYSQL_ROOT_PASSWORD must be set}"

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<EOSQL
CREATE USER IF NOT EXISTS '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD}';

GRANT SELECT, INSERT, UPDATE, DELETE
ON \`${DB_NAME}\`.*
TO '${DB_USER}'@'%';

FLUSH PRIVILEGES;
EOSQL
