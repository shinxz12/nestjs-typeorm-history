import 'reflect-metadata';
import {
  Column,
  DataSource,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Historized } from '../../src/decorators/historized';
import { historyEntities } from '../../src/metadata/history-entity-factory';
import { HistorySubscriber } from '../../src/subscriber/history-subscriber';

@Entity()
@Historized()
export class Author {
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
}

@Entity()
@Historized({ exclude: ['draftNotes'], trackSoftDelete: true })
export class Post {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;
  @Column({ default: false }) published!: boolean;
  @Column({ type: 'varchar', nullable: true }) draftNotes!: string | null;
  @ManyToOne(() => Author, { nullable: true }) author!: Author | null;
  @DeleteDateColumn() deletedAt!: Date | null;
}

@Entity()
@Historized()
export class Library {
  @PrimaryGeneratedColumn() id!: number;
  @Column() name!: string;
  @OneToMany(() => Book, (b) => b.library) books!: Book[];
}

@Entity()
@Historized()
export class Book {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;
  @ManyToOne(() => Library, (l) => l.books) library!: Library;
}

@Entity()
@Historized()
export class UserAccount {
  @PrimaryGeneratedColumn() id!: number;
  @Column() email!: string;
  @OneToOne('Profile', (p: any) => p.user) profile!: unknown;
}

@Entity()
@Historized()
export class Profile {
  @PrimaryGeneratedColumn() id!: number;
  @Column() bio!: string;
  @OneToOne(() => UserAccount, (u) => u.profile)
  @JoinColumn()
  user!: UserAccount;
}

// pk column named after a SQL reserved word: raw queries must quote identifiers.
@Entity()
@Historized()
export class ReservedPk {
  @PrimaryGeneratedColumn({ name: 'order' }) order!: number;
  @Column() label!: string;
  @ManyToOne(() => Author, { nullable: true }) author!: Author | null;
}

const csvTransformer = {
  to: (v: string[] | null) => (v == null ? v : v.join(',')),
  from: (v: string | null) => (v == null ? v : v.split(',')),
};

@Entity()
@Historized()
export class Tagged {
  @PrimaryGeneratedColumn() id!: number;
  @Column({ type: 'varchar', transformer: csvTransformer }) tags!: string[];
}

export function buildDataSource(): DataSource {
  return new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [Author, Post, Library, Book, Profile, UserAccount, Tagged, ReservedPk, ...historyEntities()],
    subscribers: [HistorySubscriber],
    synchronize: true,
  });
}
