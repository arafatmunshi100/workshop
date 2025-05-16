// image-processing.js

// Load environment variables from .env file at the very beginning
require('dotenv').config();

// Import necessary modules
const axios = require("axios"); // For fetching the image from a URL
const sharp = require("sharp");   // For image processing
const fs = require("fs");       // For file system operations
const path = require("path");   // For handling file paths
const { Ocean, ConfigHelper, Logger, Provider } = require('@oceanprotocol/lib');

/**
 * Initializes Ocean Protocol instance.
 * @returns {Promise<Ocean|null>} Ocean instance or null if config fails.
 */
async function initializeOcean() {
  const oceanNodeUrl = process.env.OCEAN_NODE_URL;
  const oceanProviderUrl = process.env.OCEAN_PROVIDER_URL;
  const chainId = process.env.OCEAN_CHAIN_ID; // e.g., 137 for Polygon, 1 for Ethereum Mainnet, 11155111 for Sepolia

  if (!oceanNodeUrl || !oceanProviderUrl || !chainId) {
    Logger.error("OCEAN_NODE_URL, OCEAN_PROVIDER_URL, and OCEAN_CHAIN_ID must be set in environment variables for Ocean.js.");
    return null;
  }

  try {
    const config = {
        metadataCacheUri: process.env.OCEAN_METADATA_CACHE_URL || 'https://aquarius.oceanprotocol.com', // Or your specific Aquarius
        networkNodeUri: oceanNodeUrl,
        providerUri: oceanProviderUrl,
        nodeUri: oceanNodeUrl, // Legacy, but good to have
        web3Provider: null, // For read-only operations, web3Provider can often be null or a provider instance if needed for signing
        verbose: true, // Enables detailed logging from Ocean.js
        chainId: parseInt(chainId)
    };

    Logger.log("Ocean.js Config:", config);
    const ocean = await Ocean.getInstance(config);
    if (ocean.provider) {
      Logger.log("Ocean Provider initialized.");
    } else {
      // If Provider instance is not automatically created, create it manually
      // This might be necessary depending on the Ocean.js version and config structure.
      // This example assumes Provider is correctly instantiated or accessible via ocean.provider
      // For direct Provider interaction without a full Ocean instance, you could do:
      // const provider = new Provider(ocean); // if ocean instance is still needed for context
      // Or more directly if Provider class can be used standalone with a URL:
      // const provider = new Provider(); // and then provider.setBaseUrl(oceanProviderUrl);
      // The exact way to use Provider for downloading may vary slightly with Ocean.js versions.
      // Refer to specific Ocean.js docs for direct Provider download/getEncryptedFiles usage.
      Logger.warn("Ocean Provider might not be initialized directly on Ocean instance. Direct Provider calls might need manual instantiation.");
    }
    return ocean;
  } catch (error) {
    Logger.error("Error initializing Ocean Protocol instance:", error.message);
    if (error.stack) Logger.error(error.stack);
    return null;
  }
}


/**
 * Downloads an asset from Ocean Protocol given its DID.
 * Assumes the asset is publicly downloadable or access is granted by the C2D environment.
 *
 * @param {Ocean} ocean - Initialized Ocean instance.
 * @param {string} did - The DID of the asset to download.
 * @param {string} downloadPath - The local path to save the downloaded file.
 * @returns {Promise<string|null>} Path to the downloaded file or null on failure.
 */
async function downloadOceanAsset(ocean, did, downloadPath) {
  if (!ocean) {
    Logger.error("Ocean instance is not available for downloading asset.");
    return null;
  }
  try {
    Logger.log(`Attempting to download asset with DID: ${did}`);

    const ddo = await ocean.assets.resolve(did);
    if (!ddo) {
      Logger.error(`Could not resolve DDO for DID: ${did}`);
      return null;
    }
    Logger.log("DDO resolved successfully.");

    // Find the access service. For public assets, this is usually straightforward.
    // For C2D, the service might be pre-selected or a specific service index provided.
    // We'll try to find the first 'access' service or a 'compute' service if 'access' is not primary.
    let service = ddo.services.find(s => s.type === 'access');
    if (!service && ddo.services.length > 0) {
        Logger.warn("No 'access' service found, trying first available service. This might not be suitable for direct download.");
        service = ddo.services[0]; // Fallback, might need adjustment based on expected DDO structure
    }

    if (!service) {
      Logger.error(`No suitable service found in DDO for DID: ${did} to download the file.`);
      return null;
    }
    Logger.log(`Using service ID: ${service.id}, type: ${service.type}`);


    // For downloading, Ocean.js typically involves an "order" step even for free assets.
    // However, for truly public assets or within C2D where access is implicit,
    // a more direct download or file URL retrieval might be possible via the Provider.

    // Using ocean.provider.downloadFile directly (new recommended way)
    // This is a simplified flow for public assets or where the provider allows direct download for the job.
    // It requires the transactionId of the file within the DDO. This is often 0 for the primary file.
    // The actual file index/txId might need to be determined from the DDO content or job definition.
    const fileIndex = 0; // Assuming the first file in the service
    const provider = ocean.provider; // Get provider from Ocean instance

    if (!provider) {
        Logger.error("Ocean Provider is not available.");
        return null;
    }

    // The downloadFile method requires more parameters than just DID and destination.
    // It often needs a pre-signed URL or direct provider interaction setup.
    // A more common C2D pattern is that INPUT_URL_0 is a pre-signed URL.
    // If we must download via DID directly, we need to handle asset ordering or use Provider's download methods.

    // Let's try Provider.getEncryptedFiles to get URLs, then download if public
    // This is a more robust way if files are marked as public and downloadable.
    const fileObjects = await provider.getEncryptedFiles(ddo.id, service.id, '0x0000000000000000000000000000000000000000'); // publisherAddress for public
    if (!fileObjects || fileObjects.length === 0) {
        Logger.error("No file objects returned by provider for download.");
        return null;
    }
    const fileUrl = fileObjects[0].url; // Assuming first file's URL

    if (!fileUrl) {
        Logger.error(`Could not get a downloadable URL for DID: ${did}`);
        return null;
    }
    Logger.log(`Publicly accessible URL obtained from provider: ${fileUrl}`);

    // Download the file from the public URL
    const response = await axios.get(fileUrl, { responseType: 'arraybuffer' });
    await fs.promises.writeFile(downloadPath, Buffer.from(response.data));

    Logger.log(`Asset ${did} downloaded successfully to ${downloadPath}`);
    return downloadPath;

  } catch (error) {
    Logger.error(`Error downloading asset ${did}:`, error.message);
    if (error.response) Logger.error("Error details (axios response):", error.response.data ? error.response.data.toString().slice(0, 200) : "No response data");
    if (error.stack) Logger.error(error.stack);
    return null;
  }
}

/**
 * Fetches image data from various sources and returns a buffer.
 *
 * @param {Ocean} oceanInstance - Initialized Ocean instance (can be null if not using DIDs).
 * @returns {Promise<Buffer|null>} A Promise that resolves with the image buffer, or null if an error occurs.
 */
async function getImageBuffer(oceanInstance) {
  const inputFile = process.env.INPUT_FILE_PATH_0; // Path provided by C2D (e.g., /data/inputs/0/my_image.png)
  const inputDid = process.env.INPUT_DID_0;       // DID provided by C2D
  const inputUrl = process.env.INPUT_IMAGE_URL || process.env.IMAGE_URL; // Direct URL (legacy or fallback)
  const defaultImageUrl = "https://raw.githubusercontent.com/oceanprotocol/c2d-examples/main/custom_algorithm/lena.png";

  try {
    if (inputFile) {
      Logger.log(`Reading image from local file path: ${inputFile}`);
      if (fs.existsSync(inputFile)) {
        return await fs.promises.readFile(inputFile);
      } else {
        Logger.error(`Error: Input file path does not exist: ${inputFile}`);
        return null;
      }
    } else if (inputDid) {
      Logger.log(`Workspaceing image from Ocean DID: ${inputDid}`);
      if (!oceanInstance) {
        Logger.error("Ocean instance not initialized, cannot process DID input.");
        return null;
      }
      const tempDownloadDir = path.join(process.env.OUTPUT_DIR || process.env.RESULTS_DIR || "/data/outputs", "temp_downloads");
      if (!fs.existsSync(tempDownloadDir)) {
        fs.mkdirSync(tempDownloadDir, { recursive: true });
      }
      // Use a unique name for the downloaded file to avoid collisions if multiple DIDs were processed
      const downloadedFilePath = path.join(tempDownloadDir, `${inputDid.replace(/[^a-zA-Z0-9]/g, '_')}.tmp`);
      const resultPath = await downloadOceanAsset(oceanInstance, inputDid, downloadedFilePath);
      if (resultPath) {
        const buffer = await fs.promises.readFile(resultPath);
        // fs.promises.unlink(resultPath).catch(err => Logger.warn(`Failed to delete temp file: ${resultPath}`, err)); // Clean up
        return buffer;
      }
      return null;
    } else if (inputUrl) {
      Logger.log(`Workspaceing image from URL: ${inputUrl}`);
      const response = await axios.get(inputUrl, { responseType: "arraybuffer" });
      return Buffer.from(response.data);
    } else {
      Logger.warn(`No specific input provided. Using default image URL: ${defaultImageUrl}`);
      const response = await axios.get(defaultImageUrl, { responseType: "arraybuffer" });
      return Buffer.from(response.data);
    }
  } catch (error) {
    Logger.error("Error getting image buffer:", error.message);
    if (error.response) Logger.error("Error details (axios response):", error.response.data ? error.response.data.toString().slice(0, 500) : "No response data");
    else if (error.request) Logger.error("Error details (axios request): No response received.");
    else Logger.error("Error details (setup/sharp/fs):", error.message);
    if (error.stack) Logger.error(error.stack);
    return null;
  }
}


/**
 * Applies a filter and optionally adds a text overlay to an image buffer.
 *
 * @param {Buffer} imageBuffer - The buffer of the input image.
 * @param {string} [filterType=null] - The type of filter to apply ('blur', 'grayscale', 'unsharp', 'none').
 * @param {string} [textToAdd=null] - The text to overlay on the image.
 * @param {string} [textColorHex='#0000FF'] - The hex color for the text.
 * @returns {Promise<Buffer|null>} A Promise that resolves with the processed image buffer, or null if an error occurs.
 */
async function applyFilterAndTextToBuffer(
  imageBuffer,
  filterType = null,
  textToAdd = null,
  textColorHex = "#0000FF"
) {
  try {
    if (!imageBuffer) {
      Logger.error("Error: Image buffer is not provided.");
      return null;
    }

    let image = sharp(imageBuffer);
    const metadata = await image.metadata();
    const imageWidth = metadata.width;
    const imageHeight = metadata.height;

    const effectiveFilterType = filterType && typeof filterType === 'string' ? filterType.trim().toLowerCase() : "none";

    if (effectiveFilterType !== "none" && effectiveFilterType !== "") {
      Logger.log(`Applying filter: ${effectiveFilterType}`);
      switch (effectiveFilterType) {
        case "blur":
          image = image.blur(5);
          break;
        case "grayscale":
          image = image.grayscale();
          break;
        case "unsharp":
          image = image.sharpen({ sigma: 1, m1: 0, m2: 3, x1:1, y2:10, y3:10});
          break;
        default:
          Logger.log(`Unknown filter: '${effectiveFilterType}'. No filter applied.`);
      }
    } else {
      Logger.log("No specific filter applied or 'none' selected.");
    }

    if (textToAdd && typeof textToAdd === 'string' && textToAdd.trim() !== "" && imageWidth && imageHeight) {
      Logger.log(`Adding text: "${textToAdd}" with color ${textColorHex}`);
      const fontSize = Math.max(12, Math.floor(imageHeight / 20));
      const padding = Math.max(5, Math.floor(imageHeight / 50));
      const svgText = `
        <svg width="${imageWidth}" height="${imageHeight}">
          <style>
            .title {
              fill: ${textColorHex};
              font-size: ${fontSize}px;
              font-family: Arial, sans-serif;
              font-weight: bold;
            }
          </style>
          <text x="50%" y="${imageHeight - fontSize / 2 - padding}" text-anchor="middle" class="title">${textToAdd}</text>
        </svg>
      `;
      const svgBuffer = Buffer.from(svgText);
      image = image.composite([{ input: svgBuffer, top: 0, left: 0 }]);
    } else {
      Logger.log("No text to add, text input was blank, or image dimensions unavailable.");
    }

    return await image.toBuffer();

  } catch (error) {
    Logger.error("Error processing image with Sharp:", error.message);
    if (error.stack) Logger.error(error.stack);
    return null;
  }
}

/**
 * Main function to orchestrate the image processing and saving.
 */
async function main() {
  Logger.log("Starting image processing script (Ocean C2D enhanced)...");

  let oceanInstance = null;
  // Initialize Ocean only if a DID input might be used or Ocean-specific features are needed
  if (process.env.INPUT_DID_0 || process.env.ENABLE_OCEAN_FEATURES) {
      oceanInstance = await initializeOcean();
      if (!oceanInstance) {
          Logger.error("Failed to initialize Ocean Protocol. Proceeding without Ocean capabilities if possible.");
          // Depending on requirements, you might choose to exit if Ocean is critical:
          // process.exit(1);
      } else {
          Logger.log("Ocean Protocol instance initialized successfully.");
      }
  }


  // Determine filter type: Ocean input -> .env -> fallback
  const filterToApply = process.env.INPUT_FILTERTYPE || process.env.DEFAULT_FILTER || null;
  const textToApply = process.env.INPUT_TEXT || process.env.DEFAULT_TEXT || null;
  const colorForText = process.env.INPUT_TEXT_COLOR || process.env.DEFAULT_TEXT_COLOR || "#00DD00"; // Default to green
  const outputDirectory = process.env.OUTPUT_DIR || process.env.RESULTS_DIR || "/data/outputs";

  Logger.log(`Configuration:`);
  Logger.log(`  Input File Path (C2D): '${process.env.INPUT_FILE_PATH_0 || 'not set'}'`);
  Logger.log(`  Input DID (C2D): '${process.env.INPUT_DID_0 || 'not set'}'`);
  Logger.log(`  Input Image URL (Legacy/Fallback): '${process.env.INPUT_IMAGE_URL || process.env.IMAGE_URL || 'not set'}'`);
  Logger.log(`  Filter: '${filterToApply || 'none'}'`);
  Logger.log(`  Text: '${textToApply || 'none'}'`);
  Logger.log(`  TextColor: '${colorForText}'`);
  Logger.log(`  OutputDir: '${outputDirectory}'`);

  const imageBufferToProcess = await getImageBuffer(oceanInstance);

  if (!imageBufferToProcess) {
    Logger.error("Fatal: Could not obtain image buffer. Cannot proceed.");
    // In a C2D job, it's good practice to write a DDO for the results, even if it's an error DDO.
    // For simplicity, we'll just exit here. In a real C2D, you'd write to /data/outputs/algo_did/0/results.json (or similar)
    // with an error status.
    return;
  }

  const processedImageBuffer = await applyFilterAndTextToBuffer(
    imageBufferToProcess,
    filterToApply,
    textToApply,
    colorForText
  );

  if (processedImageBuffer) {
    try {
      if (!fs.existsSync(outputDirectory)) {
        fs.mkdirSync(outputDirectory, { recursive: true });
        Logger.log(`Created output directory: ${outputDirectory}`);
      }

      let baseFilename = "processed_image";
      const effectiveFilter = filterToApply && typeof filterToApply === 'string' ? filterToApply.trim().toLowerCase() : "";
      if (effectiveFilter && effectiveFilter !== "none") {
          baseFilename += `_${effectiveFilter.replace(/[^a-z0-9]/gi, '_')}`;
      }
      const effectiveText = textToApply && typeof textToApply === 'string' ? textToApply.trim() : "";
      if (effectiveText) {
          baseFilename += `_with_text`;
      }
      baseFilename += ".png"; // Defaulting to PNG output
      const outputPath = path.join(outputDirectory, baseFilename);

      await fs.promises.writeFile(outputPath, processedImageBuffer);
      Logger.log(`Image processed and saved successfully as ${outputPath}`);

      // In a C2D flow, you might also write a JSON file describing the output(s)
      // e.g., /data/outputs/ddo.json or results.json
      const resultsMetadata = {
        dateCreated: new Date().toISOString(),
        algorithmDid: process.env.ALGORITHM_DID || "unknown", // C2D usually provides this
        jobId: process.env.JOB_ID || "unknown", // C2D usually provides this
        outputs: [
          {
            type: "image/png",
            filePath: baseFilename, // Relative to outputDirectory
            contentLength: processedImageBuffer.length,
            // You could add more metadata like checksums here
          }
        ]
      };
      await fs.promises.writeFile(path.join(outputDirectory, "results.json"), JSON.stringify(resultsMetadata, null, 2));
      Logger.log(`Results metadata saved to ${path.join(outputDirectory, "results.json")}`);


    } catch (error) {
      Logger.error(`Error creating output directory or saving image/metadata to ${outputDirectory}:`, error.message);
      if (error.stack) Logger.error(error.stack);
    }
  } else {
    Logger.log("Image processing failed or resulted in no image buffer. No image was saved.");
  }
}

// Execute the main function
main().catch(error => {
  Logger.error("Unhandled error in main execution:", error);
  if (error.stack) Logger.error(error.stack);
  process.exit(1);
});