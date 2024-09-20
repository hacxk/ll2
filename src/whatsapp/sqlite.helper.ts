import { Injectable, Logger } from '@nestjs/common';
import { Database, open } from 'sqlite';
import * as sqlite3 from 'sqlite3';

@Injectable()
export class SqliteHelper {
    constructor() {
        this.connect('./database/chat_database.sqlite');
    }

    private db: Database;
    private readonly logger = new Logger(SqliteHelper.name);


    async connect(dbPath: string): Promise<void> {
        try {
            this.db = await open({
                filename: './database/chat_database.sqlite',
                driver: sqlite3.Database,
            });
            this.logger.log(`Connected to SQLite database: ${dbPath}`);
        } catch (error) {
            this.logger.error(`Failed to connect to SQLite database: ${error.message}`);
            if (error instanceof Error) {
                this.logger.error(error.stack);
            }
            throw error;
        }
    }


    async runQuery(query: string, params: any[] = []): Promise<any> {
        try {
            const result = await this.db.run(query, params);

            // If no rows were affected, return an empty array
            if (result.changes === 0) {
                return [];
            } else {
                return result; // Otherwise, return the original result
            }
        } catch (error) {
            this.logger.error(`Error executing query: ${error.message}`);
            throw error;
        }
    }

    async getValues(
        tableName: string,
        columns: string[] = ['*'],
        whereClause?: { [key: string]: any }
    ): Promise<any[]> {
        try {
            const selectColumns = columns.join(', ');
            let query = `SELECT ${selectColumns} FROM ${tableName}`;
            const params: any[] = [];

            if (whereClause && Object.keys(whereClause).length > 0) {
                const conditions = Object.entries(whereClause).map(([key, value], index) => {
                    params.push(value);
                    return `${key} = ?`;
                });
                query += ` WHERE ${conditions.join(' AND ')}`;
            }

            const result = await this.db.all(query, params);
            return result;
        } catch (error) {
            this.logger.error(`Error getting values from ${tableName}: ${error.message}`);
            throw error;
        }
    }



    async getOne<T>(query: string, params: any[] = []): Promise<T | null> {
        try {
            return await this.db.get<T>(query, params);
        } catch (error) {
            this.logger.error(`Error fetching one row: ${error.message}`);
            throw error;
        }
    }

    async getAll<T>(query: string, params: any[] = []): Promise<T[]> {
        try {
            const result = await this.db.all<T>(query, params);
            return Array.isArray(result) ? result : [result]; // Wrap in array if needed
        } catch (error) {
            this.logger.error(`Error fetching all rows: ${error.message}`);
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.db) {
            await this.db.close();
            this.logger.log('SQLite database connection closed');
        }
    }
}