import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { historyRepo } from '../src/repository/history-repository';
import { Author, Book, Library, Post, Profile, UserAccount, buildDataSource } from './support/blog-fixture';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('asOf with relations', () => {
  let ds: DataSource;
  let t1: Date;

  beforeAll(async () => {
    ds = buildDataSource();
    await ds.initialize();
    const author = await ds.manager.save(Author, { name: 'Ann' });
    await ds.manager.save(Post, { title: 'p1', author });
    await ds.manager.save(Post, { title: 'p2', author });
    await tick();
    t1 = new Date();
    await tick();
    await ds.manager.save(Author, { id: author.id, name: 'Ann Renamed' });
    const p2 = await ds.manager.findOneByOrFail(Post, { title: 'p2' });
    await ds.manager.remove(Post, p2);
  });
  afterAll(() => ds.destroy());

  it('reconstructs one-to-many children as of the date', async () => {
    const lib = await ds.manager.save(Library, { name: 'lib' });
    await ds.manager.save(Book, { title: 'b1', library: lib });
    await ds.manager.save(Book, { title: 'b2', library: lib });
    await tick();
    const tBooks = new Date();
    await tick();
    const b2 = await ds.manager.findOneByOrFail(Book, { title: 'b2' });
    await ds.manager.remove(Book, b2);

    const at = await historyRepo(ds, Library).forEntity(lib.id).asOf(tBooks, { relations: ['books'] });
    expect(at!.books.map((b: any) => b.title).sort()).toEqual(['b1', 'b2']);
    const now = await historyRepo(ds, Library).forEntity(lib.id).asOf(new Date(), { relations: ['books'] });
    expect(now!.books.map((b: any) => b.title)).toEqual(['b1']);
  });

  it('does not attribute a re-parented child to its old parent', async () => {
    const libA = await ds.manager.save(Library, { name: 'libA' });
    const libB = await ds.manager.save(Library, { name: 'libB' });
    const moved = await ds.manager.save(Book, { title: 'moved', library: libA });
    await ds.manager.save(Book, { id: moved.id, title: 'moved', library: libB });
    await tick();
    const t = new Date();

    const atA = await historyRepo(ds, Library).forEntity(libA.id).asOf(t, { relations: ['books'] });
    const atB = await historyRepo(ds, Library).forEntity(libB.id).asOf(t, { relations: ['books'] });
    expect(atA!.books.map((b: any) => b.title)).toEqual([]);
    expect(atB!.books.map((b: any) => b.title)).toEqual(['moved']);
  });

  it('reconstructs many-to-one relation as of the date', async () => {
    const post = await historyRepo(ds, Post).forEntity(1).asOf(t1, { relations: ['author'] });
    expect(post!.author).toBeInstanceOf(Author);
    expect((post!.author as Author).name).toBe('Ann'); // name at t1, not 'Ann Renamed'
  });

  it('reconstructs inverse one-to-one relation as of the date', async () => {
    const user = await ds.manager.save(UserAccount, { email: 'u@example.com' });
    const profile = await ds.manager.save(Profile, { bio: 'old bio', user });
    await tick();
    const t = new Date();
    await tick();
    await ds.manager.save(Profile, { id: profile.id, bio: 'new bio', user });

    const at = await historyRepo(ds, UserAccount).forEntity(user.id).asOf(t, { relations: ['profile'] });
    expect((at!.profile as Profile).bio).toBe('old bio');
  });

  it('throws for nested relations', async () => {
    await expect(
      historyRepo(ds, Post).forEntity(1).asOf(t1, { relations: ['author.posts'] }),
    ).rejects.toThrow(/nested relations/);
  });

  it('throws for unknown relation names', async () => {
    await expect(historyRepo(ds, Post).forEntity(1).asOf(t1, { relations: ['nope'] })).rejects.toThrow(
      /unknown relation/,
    );
  });
});
