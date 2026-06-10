import multer from 'multer';
import { Request, Response, NextFunction } from 'express';
import { cloudinary } from '../lib/cloudinary';

const memStorage = multer.memoryStorage();

interface UploaderOptions {
  allowedMimeTypes: string[];
  folder: string;
  resourceType: 'raw' | 'image';
  format?: string;
}

function makeCloudinaryUploader({ allowedMimeTypes, folder, resourceType, format }: UploaderOptions) {
  const multerInstance = multer({
    storage: memStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (_req, file, cb) => {
      if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error(`Only ${allowedMimeTypes.join(', ')} files are allowed`));
      }
    },
  });

  function streamToCloudinary(req: Request, res: Response, next: NextFunction): void {
    const file = req.file;
    if (!file) {
      next();
      return;
    }

    (req.file as Express.Multer.File & { path: string; pdfBuffer: Buffer }).pdfBuffer = file.buffer;

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        type: 'upload',
        access_mode: 'public',
        ...(format ? { format } : {}),
      },
      (error, result) => {
        if (error || !result) {
          res.status(500).json({ error: 'Failed to upload to Cloudinary' });
          return;
        }
        (req.file as Express.Multer.File & { path: string }).path = result.secure_url;
        next();
      }
    );

    uploadStream.end(file.buffer);
  }

  return { multer: multerInstance, streamToCloudinary };
}

const resumeUploader = makeCloudinaryUploader({
  allowedMimeTypes: ['application/pdf'],
  folder: 'careeros/resumes',
  resourceType: 'raw',
  format: 'pdf',
});

export const uploadResume = resumeUploader.multer;
export const streamToCloudinary = resumeUploader.streamToCloudinary;

const imageUploader = makeCloudinaryUploader({
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  folder: 'careeros/profiles',
  resourceType: 'image',
});

export const uploadImage = imageUploader.multer;
export const streamImageToCloudinary = imageUploader.streamToCloudinary;
