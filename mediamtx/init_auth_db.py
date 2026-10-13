import mariadb
import config

db = mariadb.connect(
    host=config.DB_HOST,
    port=config.DB_PORT,
    user=config.DB_USER,
    password=config.DB_PASSWORD,
    database=config.DB_NAME,
)

try:
    cur = db.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(100) NOT NULL UNIQUE,
            display_name VARCHAR(150) NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_sessions (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            user_id BIGINT UNSIGNED NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            revoked_at DATETIME NULL,
            INDEX idx_session_user (user_id),
            INDEX idx_session_expiry (expires_at),
            CONSTRAINT fk_user_sessions_user
                FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE CASCADE
        ) ENGINE=InnoDB
    """)

    db.commit()
    print("OK: tabel users dan user_sessions siap.")
finally:
    db.close()
