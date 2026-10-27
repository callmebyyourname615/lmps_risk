import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { Database, PostgresStatus } from '@lmps/database';

export const POSTGRES_DATABASE = Symbol('POSTGRES_DATABASE');

@Injectable()
export class PostgresService implements OnApplicationShutdown {
  constructor(@Inject(POSTGRES_DATABASE) private readonly database: Database | null) {}

  async status(): Promise<PostgresStatus> {
    return this.database ? this.database.health() : 'not_configured';
  }

  async onApplicationShutdown() {
    await this.database?.close();
  }
}
