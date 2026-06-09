import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { cloudinary } from '../lib/cloudinary';

// Store file in memory, then stream to Cloudinary
const memStorage = multer.memoryStorage();

const multerInstance = multer({
  storage: memStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

export const uploadResume = multerInstance;

// After multer, stream buffer to Cloudinary and attach .path to req.file
export function streamToCloudinary(req: Request, res: Response, next: NextFunction): void {
  const file = req.file;
  if (!file) {
    next();
    return;
  }

  const uploadStream = cloudinary.uploader.upload_stream(
    {
      folder: 'careeros/resumes',
      resource_type: 'raw',
      format: 'pdf',
    },
    (error, result) => {
      if (error || !result) {
        res.status(500).json({ error: 'Failed to upload to Cloudinary' });
        return;
      }
      // Attach the secure URL so the route handler can use file.path
      (req.file as Express.Multer.File & { path: string }).path = result.secure_url;
      next();
    }
  );

  uploadStream.end(file.buffer);
}
