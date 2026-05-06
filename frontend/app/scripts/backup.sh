#!/bin/bash

# Configuration
DB_NAME="smart_sme_manager"
DB_USER="sme_admin"
DB_HOST="localhost"
DB_PORT="5432"
BACKUP_DIR="/backups"
RETENTION_DAYS=30

# Create backup directory
mkdir -p $BACKUP_DIR

# Generate timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/sme_backup_$TIMESTAMP.dump"
COMPRESSED_FILE="$BACKUP_FILE.gz"

# Perform backup
echo "Starting backup at $(date)"
PGPASSWORD=$DB_PASSWORD pg_dump \
    -h $DB_HOST \
    -p $DB_PORT \
    -U $DB_USER \
    -d $DB_NAME \
    -F c \
    -v \
    -f $BACKUP_FILE

# Compress backup
gzip $BACKUP_FILE

# Upload to cloud storage (optional)
# aws s3 cp $COMPRESSED_FILE s3://your-bucket/backups/

# Clean old backups
find $BACKUP_DIR -name "sme_backup_*.dump.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed at $(date)"
echo "Backup file: $COMPRESSED_FILE"
echo "Size: $(du -h $COMPRESSED_FILE | cut -f1)"

# Verify backup
pg_restore -l $COMPRESSED_FILE > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "Backup verification: SUCCESS"
else
    echo "Backup verification: FAILED"
    exit 1
fi