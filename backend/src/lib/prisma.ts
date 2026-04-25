import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Lazily construct the singleton on first property access. Module-load-time
// construction would force every importer to have DATABASE_URL set even when
// they never touch the DB — e.g. the L-series live Venice tests transitively
// import this file via lib/venice.ts and run without a database.
let _prisma: PrismaClient | null = null;

function getPrisma(): PrismaClient {
  if (_prisma) return _prisma;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is required to construct the Prisma client');
  }
  _prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  return _prisma;
}

export const prisma = new Proxy({} as PrismaClient, {
  get: (_target, prop, receiver) => Reflect.get(getPrisma() as object, prop, receiver),
  set: (_target, prop, value, receiver) =>
    Reflect.set(getPrisma() as object, prop, value, receiver),
  has: (_target, prop) => Reflect.has(getPrisma() as object, prop),
  ownKeys: () => Reflect.ownKeys(getPrisma() as object),
  getOwnPropertyDescriptor: (_target, prop) =>
    Reflect.getOwnPropertyDescriptor(getPrisma() as object, prop),
  defineProperty: (_target, prop, descriptor) =>
    Reflect.defineProperty(getPrisma() as object, prop, descriptor),
  deleteProperty: (_target, prop) => Reflect.deleteProperty(getPrisma() as object, prop),
  getPrototypeOf: () => Reflect.getPrototypeOf(getPrisma() as object),
}) as PrismaClient;
