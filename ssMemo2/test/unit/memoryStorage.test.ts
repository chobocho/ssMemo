import { createMemoryStorage } from '../../src/storage/memoryStorage.ts';
import { defineStorageContract } from '../helpers/storageContract.ts';

defineStorageContract('MemoryStorage', async () => createMemoryStorage());
