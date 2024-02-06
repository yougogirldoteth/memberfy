import sharp from 'sharp';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

interface SearchCasterProfile {
  body?: {
    avatarUrl?: string;
  };
}

export async function generateImage(validMessage: any): Promise<string | null> {
  // Log the fid to verify it's correctly extracted
  const fid = validMessage?.data.fid;
  console.log(`Fetching profile for fid: ${fid}`);

  // Return a different PNG when fid is null
  if (!fid) {
    console.error('FID is undefined or null. Returning fallback image.');
    return getFallbackImageBase64();
  }

  const fetchData = async (): Promise<string | null> => {
    try {
      const response = await fetch(`https://searchcaster.xyz/api/profiles?fid=${fid}`);
      if (!response.ok) throw new Error(`Failed to fetch profile for fid ${fid}: HTTP status ${response.status}`);

      const searchcasterData: SearchCasterProfile[] = await response.json() as SearchCasterProfile[];

      if (!Array.isArray(searchcasterData) || searchcasterData.length === 0) {
        console.error('User not found');
        return null;
      }

      const avatarUrl = searchcasterData[0]?.body?.avatarUrl;
      if (!avatarUrl) {
        console.error('Avatar URL not found');
        return null;
      }

      // Fetch avatar with retry on rate limit error (429)
      const avatarBuffer = await fetchWithRetry(`https://res.cloudinary.com/merkle-manufactory/image/fetch/c_fill,f_jpg,w_500/${avatarUrl}`);
      const { data, info } = await sharp(avatarBuffer).raw().toBuffer({ resolveWithObject: true });

      if (!data) {
        console.error('Failed to process image data');
        return null;
      }

      const gridSizeX = 12;
      const gridSizeY = 12;
      const cellWidth = Math.floor(info.width / gridSizeX);
      const cellHeight = Math.floor(info.height / gridSizeY);

      const palette: number[][] = [];

      for (let y = 0; y < gridSizeY; y++) {
        for (let x = 0; x < gridSizeX; x++) {
          const startX = x * cellWidth;
          const startY = y * cellHeight;
          const dominantColor = getDominantColorInGrid(data, startX, startY, cellWidth, cellHeight, info.width);
          palette.push(dominantColor);
        }
      }

      const coordinatesTable = [
        { x: 11, y: 6 }, // torso path 1
        { x: 7, y: 3 }, // mouth bottom 2
        { x: 3, y: 8 }, // right eye - left top 3
        { x: 4, y: 8 }, // right eye - left bottom 4
        { x: 3, y: 9 }, // right eye - right top 5
        { x: 4, y: 9 }, // right eye - right bottom 6
        { x: 3, y: 5 }, // left eye - left top 7
        { x: 3, y: 6 }, // left eye - right top 8
        { x: 4, y: 5 }, // left eye - left bottom 9
        { x: 4, y: 6 }, // left eye - right bottom 10
        { x: 6, y: 6 }, // mouth top 11
        { x: 0, y: 0 }, // BG 12
      ];

      const pathColorIndices = coordinatesTable.map(({ x, y }) => x + y * gridSizeX);

      const svgStringWithColors = constructSvgStringWithColors(palette, pathColorIndices);

      const pngBuffer = await sharp(Buffer.from(svgStringWithColors)).png().toBuffer();
      return pngBuffer.toString('base64');

    } catch (error) {
      console.error('Error fetching data:', error);
      return null;
    }
  };

  return await fetchData();
}

async function fetchWithRetry(url: string, retries = 3, backoff = 300) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      return await response.buffer();
    } else if (response.status === 429 && retries > 0) {
      console.log(`Rate limited. Retrying in ${backoff}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, retries - 1, backoff * 2); // Exponential backoff
    } else {
      throw new Error(`Failed to fetch: HTTP status ${response.status}`);
    }
  } catch (error) {
    console.error('Fetch error:', error);
    if (retries > 0) {
      console.log(`Retrying... ${retries} retries left`);
      await new Promise(resolve => setTimeout(resolve, backoff));
      return fetchWithRetry(url, retries - 1, backoff * 2);
    }
    throw error; // Rethrow error if retries are exhausted
  }
}

function getDominantColorInGrid(data: Buffer | undefined, startX: number, startY: number, cellWidth: number, cellHeight: number, width: number): number[] {
  // Initialize sum variables
  let sumRed = 0, sumGreen = 0, sumBlue = 0;

  // Check if data is defined
  if (!data) {
    console.error('Image data is undefined');
    return [0, 0, 0]; // Return a default color or handle the error as appropriate
  }

  const totalPixels = cellWidth * cellHeight;

  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      const pixelIndex = ((startY + y) * width + (startX + x)) * 3;
      sumRed += data?.[pixelIndex] ?? 0;
      sumGreen += data?.[pixelIndex + 1] ?? 0;
      sumBlue += data?.[pixelIndex + 2] ?? 0;
    }
  }

  const avgRed = Math.round(sumRed / totalPixels);
  const avgGreen = Math.round(sumGreen / totalPixels);
  const avgBlue = Math.round(sumBlue / totalPixels);

  return [avgRed, avgGreen, avgBlue];
}

async function getFallbackImageBase64(): Promise<string | null> {
  const imagePath = path.join(__dirname, 'public', 'fc_opepen.png'); // Adjust the path as necessary
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error('Error reading fallback image:', error);
    return null; // This is now valid due to the function return type being `Promise<string | null>`
  }
}

function constructSvgStringWithColors(palette: number[][], pathColorIndices: number[]): string {
  // Start constructing the SVG string
  const svgHeader = `<svg id="abstractSvg" width="1910" height="1000" xmlns="http://www.w3.org/2000/svg">`;
  const svgFooter = `</svg>`;

  const svgPaths = [
    '<rect id="path12" width="1910" height="1000" fill="COLOR" />', //BG
    '<path id="path1" d="M680 999.5C680 923.561 741.561 862 817.5 862H1092.5C1168.44 862 1230 923.561 1230 999.5V999.5H680V999.5Z" fill="COLOR" />',
    '<path id="path2" d="M1230 627.5C1230 703.439 1168.44 765 1092.5 765L817.5 765C741.561 765 680 703.439 680 627.5V627.5L1230 627.5V627.5Z" fill="COLOR" />',
    '<path id="path3" d="M955 352.5C955 276.561 1016.56 215 1092.5 215V215V352.5H955V352.5Z" fill="COLOR"/>',
    '<path id="path4" d="M955 352.5H1092.5V490V490C1016.56 490 955 428.439 955 352.5V352.5Z" fill="COLOR"/>',
    '<path id="path5" d="M1092.5 215V215C1168.44 215 1230 276.561 1230 352.5V352.5H1092.5V215Z" fill="COLOR" />',
    '<path id="path6" d="M1092.5 352.5H1230V352.5C1230 428.439 1168.44 490 1092.5 490V490V352.5Z" fill="COLOR" />',
    '<rect id="path7" x="680" y="215" width="137.5" height="137.5" fill="COLOR" />',
    '<path id="path8" d="M817.5 215V215C893.439 215 955 276.561 955 352.5V352.5H817.5V215Z" fill="COLOR" />',
    '<path id="path9" d="M680 352.5H817.5V490V490C741.561 490 680 428.439 680 352.5V352.5Z" fill="COLOR" />',
    '<path id="path10" d="M817.5 352.5H955V352.5C955 428.439 893.439 490 817.5 490V490V352.5Z" fill="COLOR" />',
    '<path id="path11" d="M1230 627.5L680 627.5V490L1230 490V627.5Z" fill="COLOR" />',
    // farcheck
    '<path d="M1253.64 215.244C1245.91 215.244 1238.2 215.244 1230.47 215.244C1230.45 214.342 1230.4 213.44 1230.45 212.522C1230.5 211.62 1231.12 210.936 1232.01 210.718C1232.29 210.656 1232.57 210.609 1232.91 210.547C1232.91 210.002 1232.91 209.458 1232.91 208.913C1232.91 206.969 1233.14 206.642 1234.92 205.973C1234.92 193.731 1234.92 181.489 1234.92 169.2C1234.14 169.2 1233.42 169.2 1232.69 169.2C1232.5 168.578 1232.35 168.018 1232.16 167.442C1231.45 165.078 1230.72 162.698 1230 160.333C1230 160.287 1230 160.224 1230 160.178C1230.31 160.162 1230.62 160.131 1230.93 160.131C1234.32 160.131 1237.7 160.131 1241.09 160.131C1241.37 160.131 1241.65 160.131 1241.99 160.131C1241.99 157.036 1241.99 154.018 1241.99 151C1257.08 151 1272.17 151 1287.24 151C1287.21 151.124 1287.17 151.249 1287.17 151.373C1287.17 154.111 1287.17 156.864 1287.17 159.602C1287.17 159.742 1287.21 159.898 1287.26 160.116C1288.26 160.116 1289.24 160.116 1290.22 160.116C1293.48 160.131 1296.73 160.147 1300 160.162C1300 160.209 1300 160.271 1300 160.318C1299.69 161.298 1299.36 162.278 1299.07 163.258C1298.48 165.233 1297.9 167.209 1297.29 169.216C1296.52 169.216 1295.8 169.216 1295.05 169.216C1295.05 181.52 1295.05 193.762 1295.05 205.989C1296.69 206.44 1297.08 206.969 1297.09 208.664C1297.09 209.287 1297.09 209.893 1297.09 210.531C1297.32 210.562 1297.46 210.593 1297.62 210.624C1298.94 210.842 1299.56 211.542 1299.58 212.896C1299.58 213.673 1299.55 214.451 1299.53 215.229C1291.8 215.229 1284.09 215.229 1276.36 215.229C1276.37 214.731 1276.37 214.249 1276.39 213.751C1276.39 213.331 1276.36 212.911 1276.4 212.507C1276.53 211.371 1277.15 210.873 1278.88 210.516C1278.88 209.753 1278.88 208.991 1278.88 208.213C1278.88 207.404 1279.2 206.689 1279.93 206.378C1280.54 206.129 1280.56 205.74 1280.54 205.227C1280.52 199.3 1280.56 193.373 1280.52 187.431C1280.52 186.404 1280.43 185.362 1280.24 184.351C1278.77 176.122 1271.36 170.631 1262.82 171.378C1254.94 172.078 1248.65 179.093 1248.65 187.213C1248.65 193.171 1248.65 199.129 1248.65 205.087C1248.65 205.398 1248.65 205.693 1248.65 205.989C1250.56 206.238 1251.12 206.876 1251.12 208.742C1251.12 209.333 1251.12 209.924 1251.12 210.5C1253.29 210.967 1253.61 211.371 1253.61 213.58C1253.61 214.156 1253.63 214.7 1253.64 215.244Z" fill="white" />'

  ];

  const svgBody = svgPaths.map((path, index) => {
    // Check if the current index is within the bounds of pathColorIndices
    if (index < pathColorIndices.length) {
      const colorIndex = pathColorIndices[index];

      // Check if colorIndex is defined and within the bounds of palette
      if (colorIndex !== undefined && colorIndex >= 0 && colorIndex < palette.length) {
        const color = palette[colorIndex];

        // Assuming color is always defined in this context
        const [r, g, b] = color ?? [0, 0, 0];
        const rgbColor = `rgb(${r}, ${g}, ${b})`;
        return path.replace('COLOR', rgbColor);
      }
    }
    return path; // Return the original path if no valid colorIndex found
  }).join('');

  return `${svgHeader}${svgBody}${svgFooter}`;
}