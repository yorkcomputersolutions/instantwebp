import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import imagemin from 'imagemin';
import imageminWebp from 'imagemin-webp';
import imageminSvgo from 'imagemin-svgo';
import multer from 'multer';
import express from 'express';
import archiver from 'archiver';

// Setup multer storage and file filter
const storage = multer.memoryStorage();
const imgfileFilter = (req, file, cb) => {
    if (file.mimetype === 'image/jpg' || file.mimetype === 'image/jpeg' || file.mimetype === 'image/png') {
        cb(null, true);
    } else {
        cb(null, false);
    }
};
const upload = multer({
    storage: storage,
    fileFilter: imgfileFilter,
    limits: {
        fieldSize: 1024 * 1024 * 2
    }
});

const app = express();

// Middleware to parse application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));

// Middleware to parse application/json
app.use(express.json());

const options = {
    index: 'index.html'
};

app.get('/', (req, res) => {
    res.sendFile('index.html', { root: '.' });
});

const clients = [];

app.get('/progress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Add client to list
    clients.push(res);

    // Clean up when client disconnects
    req.on('close', () => {
        clients.splice(clients.indexOf(res), 1);
    });
});

function sendProgressUpdate(data) {
    clients.forEach(client => {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

// Define a route to handle multiple file uploads and other form data
app.post('/mix', upload.array('images', 1000), async (req, res) => {
    console.log('Files:', req.files); // Files information (in memory)
    console.log('Form Data:', req.body); // Other form data

    if (req.files && req.files.length > 0) {
        try {
            const archive = archiver('zip', { zlib: { level: 9 } });
            res.setHeader('Content-Type', 'application/zip');
            res.setHeader('Content-Disposition', 'attachment; filename=optimized_images.zip');

            archive.pipe(res);

            let totalFiles = req.files.length;
            let processedFiles = 0;

            for (const file of req.files) {
                const buffer = await Resize(file.buffer);
                const optimizedFiles = await OptimizeWebp(buffer);

                // Ensure optimizedFiles[0].data is a Buffer
                if (optimizedFiles.length > 0) {
                    console.log('OPTIMIZED FILES: ', optimizedFiles);
                    const webpBuffer = Buffer.from(optimizedFiles[0].data);
                    archive.append(webpBuffer, { name: file.originalname.replace(/\.[^/.]+$/, ".webp") });

                    // Emit progress update
                    processedFiles++;
                    sendProgressUpdate({
                        file: file.originalname,
                        processedFiles: processedFiles,
                        totalFiles: totalFiles
                    });
                }
            }

            archive.finalize();

        } catch (error) {
            console.error('Error processing files:', error);
            res.status(500).json({ statusCode: 0, message: 'File processing failed!', error: error.message });
        }
    } else {
        res.status(400).json({ statusCode: 0, message: 'No files uploaded!' });
    }
});

// Start the server
const port = 8081;
app.listen(port, () => {
    console.log(`my app is listening at http://localhost:${port}`);
});

// Helper functions
async function Resize(srcBuffer) {
    return await sharp(srcBuffer)
        .resize({ width: 2048, withoutEnlargement: true })
        .trim()
        .toBuffer();
}

async function OptimizeWebp(srcBuffer) {
    const files = await imagemin.buffer(srcBuffer, {
        plugins: [
            imageminWebp({ quality: 75, lossless: false, method: 6 }),
        ]
    });

    // Return an array with a single buffer (you can also handle multiple files if needed)
    return [{ data: files }];
}