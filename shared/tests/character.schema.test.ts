import { describe, expect, it } from 'vitest';
import {
  characterCreateSchema,
  characterReorderSchema,
  characterResponseSchema,
  characterSchema,
  charactersResponseSchema,
  characterUpdateSchema,
} from '../src/schemas/character';

const validCharacter = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  storyId: '550e8400-e29b-41d4-a716-446655440001',
  name: 'Imogen Thorne',
  role: 'protagonist',
  age: '34',
  appearance: 'tall, auburn hair',
  personality: 'wry, distrusts kindness',
  voice: 'measured alto with a Devon edge',
  backstory: 'Widowed at 28.',
  arc: 'from grief-numbed widow to reluctant insurgent',
  relationships: 'Sister to Felix; estranged from her father.',
  orderIndex: 0,
  color: null,
  initial: null,
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
};

describe('characterSchema', () => {
  it('accepts a fully-populated valid character', () => {
    expect(() => characterSchema.parse(validCharacter)).not.toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => characterSchema.parse({ ...validCharacter, nickname: 'Im' })).toThrow();
  });

  it('rejects missing required name', () => {
    const { name: _name, ...rest } = validCharacter;
    expect(() => characterSchema.parse(rest)).toThrow();
  });

  it('accepts null for every optional narrative field', () => {
    const minimal = {
      ...validCharacter,
      role: null,
      age: null,
      appearance: null,
      personality: null,
      voice: null,
      backstory: null,
      arc: null,
      relationships: null,
    };
    expect(() => characterSchema.parse(minimal)).not.toThrow();
  });

  it('rejects non-ISO datetime in createdAt', () => {
    expect(() => characterSchema.parse({ ...validCharacter, createdAt: 'not a date' })).toThrow();
  });

  it('rejects non-uuid id', () => {
    expect(() => characterSchema.parse({ ...validCharacter, id: 'not-a-uuid' })).toThrow();
  });
});

describe('characterCreateSchema', () => {
  it('accepts minimal input (name only)', () => {
    expect(() => characterCreateSchema.parse({ name: 'Bystander' })).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() => characterCreateSchema.parse({ name: '' })).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() => characterCreateSchema.parse({ name: 'X', physicalDescription: 'tall' })).toThrow();
  });

  it('accepts all 9 narrative fields', () => {
    expect(() =>
      characterCreateSchema.parse({
        name: 'X',
        role: 'rival',
        age: '40',
        appearance: 'tall',
        personality: 'cold',
        voice: 'flat',
        backstory: 'orphan',
        arc: 'redemption',
        relationships: 'rival to Imogen',
      }),
    ).not.toThrow();
  });
});

describe('characterUpdateSchema', () => {
  it('accepts empty input (all fields optional)', () => {
    expect(() => characterUpdateSchema.parse({})).not.toThrow();
  });

  it('still rejects unknown fields (strict preserved through partial)', () => {
    expect(() => characterUpdateSchema.parse({ nickname: 'Im' })).toThrow();
  });
});

describe('response wrappers', () => {
  it('characterResponseSchema accepts { character }', () => {
    expect(() => characterResponseSchema.parse({ character: validCharacter })).not.toThrow();
  });

  it('characterResponseSchema rejects extra top-level fields', () => {
    expect(() => characterResponseSchema.parse({ character: validCharacter, foo: 1 })).toThrow();
  });

  it('charactersResponseSchema accepts { characters: [...] }', () => {
    expect(() => charactersResponseSchema.parse({ characters: [validCharacter] })).not.toThrow();
  });
});

describe('characterReorderSchema', () => {
  it('accepts { characters: [{ id, orderIndex }] }', () => {
    expect(() =>
      characterReorderSchema.parse({
        characters: [{ id: validCharacter.id, orderIndex: 0 }],
      }),
    ).not.toThrow();
  });

  it('rejects extra fields on each item', () => {
    expect(() =>
      characterReorderSchema.parse({
        characters: [{ id: validCharacter.id, orderIndex: 0, extra: true }],
      }),
    ).toThrow();
  });
});
