import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import sharp from 'sharp';
import imagemin from 'imagemin';
import imageminWebp from 'imagemin-webp';
import multer from 'fastify-multer'; // Fastify-compatible multer
import fastify from 'fastify';
import archiver from 'archiver';
import fastifyStatic from '@fastify/static'; // Fastify static plugin
import formbody from '@fastify/formbody';
import multipart from '@fastify/multipart';

// Workaround to get __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

const app = fastify();

// Register necessary plugins
app.register(fastifyFormbody);
app.register(fastifyMultipart);
app.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/', // optional: default '/'
});

// SSE clients list
const clients = [];

app.get('/progress', (req, res) => {
    res.raw.setHeader('Content-Type', 'text/event-stream');
    res.raw.setHeader('Cache-Control', 'no-cache');
    res.raw.setHeader('Connection', 'keep-alive');

    // Add client to list
    clients.push(res.raw);

    // Clean up when client disconnects
    req.raw.on('close', () => {
        clients.splice(clients.indexOf(res.raw), 1);
    });
});

function sendProgressUpdate(data) {
    clients.forEach(client => {
        client.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

// Define a route to handle multiple file uploads and other form data
app.post('/process', { preHandler: upload.array('images', 1000) }, async (req, res) => {
    if (req.files && req.files.length > 0) {
        let maxWidth = Number(req.body.max_width);

        try {
            const archive = archiver('zip', { zlib: { level: 9 } });
            res.raw.setHeader('Content-Type', 'application/zip');
            res.raw.setHeader('Content-Disposition', 'attachment; filename=optimized_images.zip');

            archive.pipe(res.raw);

            let totalFiles = req.files.length;
            let processedFiles = 0;

            await Promise.all(req.files.map(async (file) => {
                let buffer = file.buffer;

                if (maxWidth > 0) {
                    buffer = await Resize(buffer, maxWidth);
                }
                const optimizedFiles = await OptimizeWebp(buffer);

                // Ensure optimizedFiles[0].data is a Buffer
                if (optimizedFiles.length > 0) {
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
            }));

            archive.finalize();

        } catch (error) {
            console.error('Error processing files:', error);
            res.status(500).send({ statusCode: 0, message: 'File processing failed!', error: error.message });
        }
    } else {
        res.status(400).send({ statusCode: 0, message: 'No files uploaded!' });
    }
});

// Start the server
const port = 8081;
app.listen({ port }, (err) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server is listening at http://localhost:${port}`);
});

// Helper functions
async function Resize(srcBuffer, maxWidth) {
    return await sharp(srcBuffer)
        .resize({ width: maxWidth, withoutEnlargement: true })
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