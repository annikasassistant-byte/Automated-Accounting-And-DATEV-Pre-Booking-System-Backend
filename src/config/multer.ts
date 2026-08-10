import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import env from './env.js';

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/** Always allow Bank/PayPal CSV uploads even if Render env omits them (DEF-001). */
const REQUIRED_ACCOUNTING_MIME = [
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

const allowedMimeTypes = [
  ...new Set([
    ...env.UPLOAD_ALLOWED_MIME.split(',')
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean),
    ...REQUIRED_ACCOUNTING_MIME,
  ]),
];

const maxFileSizeBytes = env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Shared file filter enforcing allow-listed MIME types.
 * @param {import('express').Request} _req
 * @param {Express.Multer.File} file
 * @param {multer.FileFilterCallback} cb
 */
function fileFilter(_req, file, cb) {
  const mime = String(file.mimetype || '').toLowerCase();
  const ext = path.extname(file.originalname || '').toLowerCase();
  const csvExt = ext === '.csv' || ext === '.txt';

  if (allowedMimeTypes.includes(mime)) {
    cb(null, true);
    return;
  }

  // Some browsers/OS send octet-stream or empty MIME for CSV — allow by extension.
  if (csvExt && (!mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream')) {
    cb(null, true);
    return;
  }

  cb(
    new Error(
      `Unsupported file type "${file.mimetype}". Allowed: ${allowedMimeTypes.join(', ')}`,
    ),
  );
}

/**
 * Disk storage — persists files under UPLOAD_DIR with UUID filenames.
 */
export const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 50);
    cb(null, `${Date.now()}-${uuidv4()}-${safeBase}${ext}`);
  },
});

/**
 * Memory storage — keeps file buffers in memory (ideal for Cloudinary/S3 streaming).
 */
export const memoryStorage = multer.memoryStorage();

/**
 * Multer instance writing to disk.
 */
export const uploadDisk = multer({
  storage: diskStorage,
  limits: {
    fileSize: maxFileSizeBytes,
    files: env.UPLOAD_MAX_FILES,
  },
  fileFilter,
});

/**
 * Multer instance keeping files in memory.
 */
export const uploadMemory = multer({
  storage: memoryStorage,
  limits: {
    fileSize: maxFileSizeBytes,
    files: env.UPLOAD_MAX_FILES,
  },
  fileFilter,
});

export const multerConfig = Object.freeze({
  uploadDir,
  maxFileSizeBytes,
  maxFiles: env.UPLOAD_MAX_FILES,
  allowedMimeTypes,
});

export default {
  diskStorage,
  memoryStorage,
  uploadDisk,
  uploadMemory,
  multerConfig,
};
