import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import { cloudinary } from '../lib/cloudinary';

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'careeros/resumes',
    resource_type: 'raw',
    allowed_formats: ['pdf'],
  } as Record<string, unknown>,
});

export const uploadResume = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});
