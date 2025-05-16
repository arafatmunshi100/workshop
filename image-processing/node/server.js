// node/server.js

// Load environment variables from .env file (if you have one)
require('dotenv').config();

const express = require('express');
const multer = require('multer'); // For handling file uploads
const sharp = require('sharp');
const path = require('path'); // For serving static files

const app = express();
const port = process.env.PORT || 3000; // Use port from .env or default to 3000

// --- Middleware ---
// For parsing application/json
app.use(express.json());
// For parsing application/x-www-form-urlencoded (text parameters from form)
app.use(express.urlencoded({ extended: true }));

// Serve static files (like index.html, css, client-side js) from the 'public' directory
// Make sure you have a 'public' folder in your 'node' directory, and your index.html is inside it.
app.use(express.static(path.join(__dirname, 'public')));

// --- Multer Configuration for Image Uploads ---
// We'll store the image in memory for processing with Sharp
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // Limit file size to 10MB
    fileFilter: (req, file, cb) => {
        // Accept only image files
        const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/tiff'];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only image files are allowed.'), false);
        }
    }
});

// --- Image Processing Logic ---

/**
 * Helper function to escape XML special characters for SVG text content.
 * @param {string} str - The input string.
 * @returns {string} The escaped string.
 */
function xmlEscape(str) {
    if (typeof str !== 'string') {
        return '';
    }
    // Basic escaping, you might want a more robust library for complex cases
    return str.replace(/[<>&'"]/g, function (match) {
        switch (match) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case "'": return '&apos;';
            case '"': return '&quot;';
            default: return match;
        }
    });
}

/**
 * Adds text overlay to an image.
 * @param {Buffer} imageBuffer - The buffer of the input image.
 * @param {string} textValue - The text to overlay.
 * @param {object} options - Text styling and positioning options.
 * @returns {Promise<{buffer: Buffer, format: string}>} A Promise that resolves with the processed image buffer and its format.
 */
async function addTextToImage(imageBuffer, textValue, options = {}) {
    try {
        const image = sharp(imageBuffer);
        const metadata = await image.metadata();

        // Determine a dynamic default font size based on image dimensions
        const defaultFontSize = Math.max(20, Math.min(metadata.width, metadata.height) / 12);
        const currentFontSize = parseInt(options.fontSize, 10) || defaultFontSize;

        const textOpts = {
            text: xmlEscape(textValue || "Sample Text"),
            fontFamily: options.fontFamily || 'Arial',  // Ensure this font is available on your server
            fontSize: currentFontSize,
            fontColor: options.fontColor || '#FFFFFF',
            strokeColor: options.strokeColor || '#000000', // Stroke for better visibility
            strokeWidth: parseInt(options.strokeWidth, 10) >= 0 ? parseInt(options.strokeWidth, 10) : Math.max(1, currentFontSize / 20), // Dynamic stroke width
            xPosition: options.xPosition || '50%',
            yPosition: options.yPosition || '50%',
            textAlign: options.textAlign || 'middle',
            dominantBaseline: options.dominantBaseline || 'middle',
            outputFormat: (options.outputFormat || metadata.format || 'png').toLowerCase(),
        };

        // Validate and sanitize output format
        const validFormats = ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'gif', 'avif'];
        if (!validFormats.includes(textOpts.outputFormat)) {
            console.warn(`Invalid output format: ${textOpts.outputFormat}. Defaulting to png.`);
            textOpts.outputFormat = 'png';
        }
        if (textOpts.outputFormat === 'jpg') { // Alias jpg to jpeg
            textOpts.outputFormat = 'jpeg';
        }

        const svgText = `
          <svg width="${metadata.width}" height="${metadata.height}">
            <style>
              .title {
                fill: "${textOpts.fontColor}";
                font-size: ${textOpts.fontSize}px;
                font-family: "${textOpts.fontFamily}";
                text-anchor: "${textOpts.textAlign}";
                dominant-baseline: "${textOpts.dominantBaseline}";
                paint-order: stroke; /* Ensures stroke is drawn behind fill */
                stroke: "${textOpts.strokeColor}";
                stroke-width: ${textOpts.strokeWidth}px;
                stroke-linecap: round; /* Smoother stroke ends */
                stroke-linejoin: round; /* Smoother stroke joins */
              }
            </style>
            <text x="${textOpts.xPosition}" y="${textOpts.yPosition}" class="title">${textOpts.text}</text>
          </svg>
        `;
        const svgBuffer = Buffer.from(svgText);

        const processedImageInstance = image.composite([{
            input: svgBuffer,
        }]);
        
        // Handle format specific options for output
        let finalBuffer;
        const qualityOptions = { quality: 85 }; // General quality for lossy formats

        switch (textOpts.outputFormat) {
            case 'jpeg':
                finalBuffer = await processedImageInstance.jpeg(qualityOptions).toBuffer();
                break;
            case 'png':
                finalBuffer = await processedImageInstance.png({ compressionLevel: 6 }).toBuffer(); // PNG specific options
                break;
            case 'webp':
                finalBuffer = await processedImageInstance.webp(qualityOptions).toBuffer();
                break;
            case 'avif':
                finalBuffer = await processedImageInstance.avif({ quality: 60 }).toBuffer(); // AVIF can often use lower quality numbers
                break;
            case 'tiff':
                 finalBuffer = await processedImageInstance.tiff(qualityOptions).toBuffer();
                 break;
            default: // For gif or other formats sharp supports without specific options here
                finalBuffer = await processedImageInstance.toFormat(textOpts.outputFormat).toBuffer();
                break;
        }
        
        return { buffer: finalBuffer, format: textOpts.outputFormat };

    } catch (error) {
        console.error('Error in addTextToImage:', error);
        throw new Error(`Failed to add text overlay: ${error.message}`);
    }
}

// --- API Endpoints ---

// A simple root route to confirm the server is running if index.html isn't served
// Note: If public/index.html exists, app.use(express.static(...)) will serve it for '/'
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'UP', message: 'Image Processing Service is running.'});
});

/**
 * @route POST /api/image/add-text
 * @description Adds text overlay to an uploaded image.
 * Expects 'multipart/form-data'.
 */
app.post('/api/image/add-text', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No image file uploaded.' });
    }
    if (!req.body.text && req.body.text !== "") { // Allow empty string for text if intended
        return res.status(400).json({ error: 'No text parameter provided for overlay.' });
    }

    try {
        const imageBuffer = req.file.buffer;
        const textValue = req.body.text;

        // Gather options from request body
        const options = {
            fontFamily: req.body.fontFamily,
            fontSize: req.body.fontSize,
            fontColor: req.body.fontColor,
            strokeColor: req.body.strokeColor,
            strokeWidth: req.body.strokeWidth,
            xPosition: req.body.xPosition,
            yPosition: req.body.yPosition,
            textAlign: req.body.textAlign,
            dominantBaseline: req.body.dominantBaseline,
            outputFormat: req.body.outputFormat
        };

        const { buffer: outputBuffer, format: outputFormat } = await addTextToImage(imageBuffer, textValue, options);

        res.set('Content-Type', `image/${outputFormat}`);
        res.send(outputBuffer);

    } catch (error) {
        console.error('Route /api/image/add-text error:', error);
        res.status(500).json({ error: error.message || 'An error occurred while processing the image.' });
    }
});

// --- Global Error Handler (especially for Multer and other unhandled errors) ---
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        // A Multer error occurred when uploading.
        console.error('Multer error:', err);
        return res.status(400).json({ error: `File upload error: ${err.message}. Check file size or type.` });
    } else if (err) {
        // An unknown error occurred.
        console.error('Unhandled error:', err);
        return res.status(500).json({ error: err.message || 'An unexpected error occurred.' });
    }
    // If no error, but route not found after static and API routes (should ideally be a 404 handler)
    if (!res.headersSent) {
        res.status(404).json({ error: 'Resource not found.' });
    }
});


// --- Start Server ---
app.listen(port, () => {
    console.log(`Image processing server listening at http://localhost:${port}`);
    console.log(`Frontend should be accessible at http://localhost:${port}/index.html (or just http://localhost:${port}/ if index.html is in public dir)`);
});