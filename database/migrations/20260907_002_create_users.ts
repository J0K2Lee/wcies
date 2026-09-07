import { MigrationInterface, QueryRunner, Table, TableUnique } from 'typeorm';

/**
 * Sprint 0 minimal users table backing AuthModule
 * (id / username / email / password_hash / status / role - S0 spec §58).
 */
export class CreateUsers1788700800002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
          },
          { name: 'username', type: 'varchar', length: 100, isNullable: false },
          { name: 'email', type: 'varchar', length: 255, isNullable: true },
          { name: 'password_hash', type: 'text', isNullable: false },
          { name: 'status', type: 'varchar', length: 20, isNullable: false, default: `'ACTIVE'` },
          { name: 'role', type: 'varchar', length: 20, isNullable: false, default: `'ADMIN'` },
          { name: 'created_at', type: 'timestamptz', isNullable: false, default: 'now()' },
          { name: 'updated_at', type: 'timestamptz', isNullable: false, default: 'now()' },
        ],
        uniques: [
          new TableUnique({ name: 'uq_users_username', columnNames: ['username'] }),
          new TableUnique({ name: 'uq_users_email', columnNames: ['email'] }),
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('users');
  }
}
