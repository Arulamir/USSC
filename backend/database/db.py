import mysql.connector
from backend.config import Config

def get_connection():
    return mysql.connector.connect(
        host=Config.DB_HOST,
        user=Config.DB_USER,
        password=Config.DB_PASSWORD,
        database=Config.DB_NAME,
        port=getattr(Config, "DB_PORT", 3306)
    )