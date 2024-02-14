import sharp from 'sharp';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import kmeans from "kmeans-ts";

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

      const gridSizeX = 9;
      const gridSizeY = 9;
      const cellWidth = Math.floor(info.width / gridSizeX);
      const cellHeight = Math.floor(info.height / gridSizeY);

      const palette: number[][] = [];

      for (let y = 0; y < gridSizeY; y++) {
        for (let x = 0; x < gridSizeX; x++) {
          const startX = x * cellWidth;
          const startY = y * cellHeight;
          const dominantColor = getDominantColorInGrid(data, startX, startY, cellWidth, cellHeight, info.width);
          palette.push(await dominantColor);
        }
      }

      // x is column and y is row (diff than usual)
      const coordinatesTable = [
        { x: 0, y: 0 }, // BG 
        { x: 0, y: 0 }, // changes nothin 
        { x: 0, y: 0 }, // changes nothin
        { x: 1, y: 3 }, // 
        { x: 3, y: 3 }, // 
        { x: 5, y: 4 }, // 
        { x: 7, y: 4 }, //
        { x: 1, y: 5 }, // 
        { x: 3, y: 5 }, //
        { x: 5, y: 6 }, // 
        { x: 7, y: 6 }, // 
      ];

      const pathColorIndices = coordinatesTable.map(({ x, y }) => x + y * gridSizeX);
      const fidNumber = Number(fid);

      const svgStringWithColors = constructSvgStringWithColors(palette, pathColorIndices, fidNumber);

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

async function getDominantColorInGrid(data: Buffer, startX: number, startY: number, cellWidth: number, cellHeight: number, width: number): Promise<number[]> {
  const pixels: number[][] = [];
  for (let y = 0; y < cellHeight; y++) {
    for (let x = 0; x < cellWidth; x++) {
      const pixelIndex = ((startY + y) * width + (startX + x)) * 3;
      pixels.push([
        data[pixelIndex] ?? 0,     // Red
        data[pixelIndex + 1] ?? 0, // Green
        data[pixelIndex + 2] ?? 0, // Blue
      ]);
    }
  }

  const K = 1; // Assuming we want a single dominant color
  const result = await kmeans(pixels, K);

  // Check if centroids are returned, not undefined, and the first element exists
  if (!result.centroids || result.centroids.length === 0 || result.centroids[0] === undefined) {
    throw new Error('No valid centroids returned from kmeans.');
  }

  // Now that we've checked centroids[0] is not undefined, we can safely access it
  const dominantColor = result.centroids[0].map(Math.round);
  return dominantColor;
}

async function getFallbackImageBase64(): Promise<string | null> {
  const imagePath = path.join(__dirname, 'public', 'fc_degen.png'); // Adjust the path as necessary
  try {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
  } catch (error) {
    console.error('Error reading fallback image:', error);
    return null; // This is now valid due to the function return type being `Promise<string | null>`
  }
}

function getColorForFid(fid: number): string {
  if (fid < 1000) return 'gold';
  else if (fid < 10000) return '#855DCD';
  else if (fid < 20000) return '#94E337';
  else return 'white'; // Default color
}


function constructSvgStringWithColors(palette: number[][], pathColorIndices: number[], fid: number): string {
  const svgHeader = `<svg width="1200" height="1200" fill="none" xmlns="http://www.w3.org/2000/svg">`;
  const svgFooter = `</svg>`;

  // Determine the color for the farcheck based on fid
  const farcheckColor = getColorForFid(fid);

  const farcheck = `<path fill-opacity=".9" d="m364.421 614.551 471.445-.442 8.159 99.486 8.82 111.617-486.219 1.986-10.143-112.5 7.938-100.147Z" fill="${farcheckColor}" />`;

  const backgroundColor = palette ? `rgb(${palette[0]?.[0]}, ${palette[0]?.[1]}, ${palette[0]?.[2]})` : 'rgb(255, 255, 255)';
  const backgroundPath = `<path fill="${backgroundColor}" d="M0 0h1200v1200H0z"/>`; // Adjust as necessary

  const svgPaths = [
    '<path d="" fill="COLOR"/>',
    ' <path d="M598.781 305.872c27.625 0 55.254-.339 82.875.102 23.643.379 47.303 1.173 70.902 2.669 20.803 1.315 41.566 3.525 62.271 5.956 14.197 1.668 25.963 8.25 33.932 20.554 4.803 7.408 6.567 15.622 5.892 24.415-1.094 14.215-2.121 28.438-3.175 42.653-1.372 18.468-2.757 36.94-4.119 55.407-.984 13.341-1.923 26.683-2.902 40.024-1.381 18.763-2.788 37.526-4.163 56.29-.997 13.632-1.95 27.269-2.946 40.905-.494 6.742-1.147 13.478-1.522 20.228-.132 2.396-.931 3.644-3.29 4.425-32.22 10.686-64.428 21.38-97.971 27.322-18.523 3.283-37.134 5.855-55.864 7.606-32.374 3.031-64.815 3.909-97.301 3.269-46.659-.917-92.97-5.1-138.553-15.679-21.641-5.021-42.761-11.793-63.784-18.896-3.757-1.27-7.519-2.541-11.325-3.644-2.108-.613-3.136-1.645-3.268-3.97-.34-6.014-.979-12.014-1.416-18.022-1.887-26.096-3.726-52.196-5.614-78.292-1.729-23.898-3.484-47.792-5.257-71.686-2.196-29.612-4.555-59.211-6.589-88.831-.952-13.884 4.441-25.28 15.193-34.033 7.132-5.805 15.405-9.247 24.525-10.116 17.689-1.681 35.4-3.229 53.12-4.526 53.376-3.909 106.849-4.615 160.34-4.134l.009.004Z" fill="url(#b)"/>',
    '<g filter="url(#a)"> <path d="M608.726 894.415c-63.819-.498-118.064-6.918-171.1-22.143-28.918-8.302-56.803-19.147-82.554-34.928-31.356-19.213-58.165-43.31-78.329-74.342-11.162-17.18-19.289-35.656-22.681-56.007-1.627-9.755-2.668-19.624-.401-29.365 4.084-17.55 14.465-29.713 32.044-34.774 10.478-3.017 20.763-1.482 30.271 3.816 11.806 6.578 23.414 13.514 35.184 20.162 2.276 1.284 8.291 6.878 8.41 9.261 0 7.5-2.937 25.614-2.205 41.029.221 4.659 1.107 9.807 4.141 13.257 9.482 10.783 20.499 19.787 32.291 27.869 26.96 18.477 56.644 30.953 88.018 39.592 23.568 6.489 47.581 10.473 71.921 12.723 24.339 2.25 48.719 2.55 73.085 1.394 40.11-1.897 79.422-8.422 117.336-22.107 27.978-10.099 54.17-23.532 77.102-42.71 6.175-5.167 10.885-10.412 16.591-16.121 3.088-3.75 5.115-7.941 5.813-12.591 1.023-6.821-3.137-34.835-2.726-44.321.146-3.353 6.391-6.273 9.368-7.914 10.421-5.74 20.855-11.506 30.937-17.815 27.462-17.188 59.171-.305 65.446 29.215 2.113 9.93 1.222 19.91-.485 29.805-4.114 23.828-14.456 44.947-28.564 64.306-22.933 31.469-52.296 55.483-86.532 73.655-28.745 15.251-59.4 25.336-90.937 32.867-28.189 6.728-56.741 11.361-85.64 13.514-18.153 1.354-36.344 2.135-45.8 2.678l-.004-.005Z" fill="url(#c)" /></g>',
    '<defs> <linearGradient id="b" x1="345.458" y1="455.065" x2="854.829" y2="458.592" gradientUnits="userSpaceOnUse"> <stop/> <stop stop-color="COLOR"/>',
    '<stop offset=".335" stop-color="COLOR"/>',
    '<stop offset=".69" stop-color="COLOR"/>',
    '<stop offset="1" stop-color="COLOR"/> </linearGradient>',
    '<linearGradient id="c" x1="252.313" y1="748.648" x2="947.888" y2="757.8" gradientUnits="userSpaceOnUse"> <stop/> <stop stop-color="COLOR"/> ',
    '<stop offset=".335" stop-color="COLOR"/>',
    '<stop offset=".69" stop-color="COLOR"/>',
    '<stop offset="1" stop-color="COLOR"/> </linearGradient> <filter id="a" x="252.4" y="285.7" width="715.6" height="608.7" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"> <feFlood flood-opacity="0" result="BackgroundImageFix"/> <feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"/> <feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/> <feOffset dx="20" dy="-20"/> <feGaussianBlur stdDeviation="10"/> <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/> <feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.27 0"/> <feBlend mode="soft-light" in2="shape" result="effect1_innerShadow_423_1042"/> </filter></defs>',


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


  return `${svgHeader}${backgroundPath}${farcheck}${svgBody}${svgFooter}`;
}