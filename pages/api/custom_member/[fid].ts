// pages/api/custom_member/[id].ts
import type { NextApiRequest, NextApiResponse } from 'next';
import fetch from 'node-fetch';
import sharp from 'sharp';
import kmeans from "kmeans-ts";


export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {

    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const { fid } = req.query;

    if (typeof fid !== 'string') {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const buffer = await generateImage({ data: { fid } });

    if (!buffer) {
      return res.status(404).send('Image not found');
    }

    // Set the Content-Type header to indicate PNG image
    res.setHeader('Content-Type', 'image/png');

    // Send the image data as the response
    res.status(200).send(buffer);
  } catch (error) {
    console.error('Error generating scaled scape:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}

interface SearchCasterProfile {
  body?: {
    avatarUrl?: string;
  };
}

async function generateImage(validMessage: any): Promise<Buffer | null> {
  const fid = validMessage?.data?.fid;
  console.log(`Fetching profile for fid: ${fid}`);

  if (!fid) {
    console.error('FID is undefined or null. Returning fallback image.');
    return null; 
  }

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

    // Fetch avatar 
    const avatarBuffer = await fetchWithRetry(`https://res.cloudinary.com/merkle-manufactory/image/fetch/c_fill,f_jpg,w_500/${avatarUrl}`);

    // Pixeling helping with finding dominant color
    const pixelatedBuffer = await sharp(avatarBuffer)
      .resize(25, 25) // Pixelate by resizing down
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { data, info } = pixelatedBuffer;
    if (!data) {
      console.error('Failed to process image data');
      return null;
    }

    // dividing input image into grid
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

    // assigning grid cells to svg paths, x is column and y is row 
    const coordinatesTable = [
      { x: 0, y: 0 }, // BG
      { x: 4, y: 4 }, // head
      { x: 5, y: 4 }, // head
      { x: 4, y: 7 }, // eye brows
      { x: 0, y: 0 }, // changes nothin - eyes
      { x: 5, y: 5 }, // noggles
      { x: 0, y: 0 }, // changes nothin - umriss
      { x: 4, y: 6 }, // body

    ];

    const pathColorIndices = coordinatesTable.map(({ x, y }) => x + y * gridSizeX);
    const fidNumber = Number(fid);
    const svgStringWithColors = constructSvgStringWithColors(palette, pathColorIndices, fidNumber);
    const pngBuffer = await sharp(Buffer.from(svgStringWithColors)).png().toBuffer();

    return pngBuffer;

  } catch (error) {
    console.error('Error fetching data:', error);
    return null;
  }
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

  const K = 1;
  const result = await kmeans(pixels, K);

  // Check if centroids are returned, not undefined, and the first element exists
  if (!result.centroids || result.centroids.length === 0 || result.centroids[0] === undefined) {
    throw new Error('No valid centroids returned from kmeans.');
  }

  // Now that we've checked centroids[0] is not undefined, we can safely access it
  const dominantColor = result.centroids[0].map(Math.round);
  return dominantColor;
}



// not used for this project, but could color any path based on fid (farcaster id)
function getColorForFid(fid: number): string {
  if (fid < 1000) return 'gold';
  else if (fid < 10000) return '#855DCD'; // FC purple
  else if (fid < 20000) return '#CCFF00'; // sendit green
  else if (fid < 100000) return '#0857FF'; // based blue
  else return '#1F1D2A'; // Default color
}



function constructSvgStringWithColors(palette: number[][], pathColorIndices: number[], fid: number): string {
  const svgHeader = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" fill="none">`;
  const svgFooter = `</svg>`;

 // Determine the color for the farrow based on fid
  const farcheckColor = getColorForFid(fid)
  const farcheck = `<path d="M853 213h-42v43h42v-43Zm-128 0h-42v43h42v-43Zm43-42h-43v42h43v-42Zm43-43h-43v43h43v-43Zm0-43h-43v43h43V85Zm-43 0h-43v43h43V85Zm-43 0h-42v43h42V85Zm128 0h-42v43h42V85Zm0 43h-42v43h42v-43Zm0 43h-42v42h42v-42Z" fill="${farcheckColor}" />`;

  const svgPaths = [
    '<path fill="COLOR" d="M1024 0H0v1024h1024V0Z"/>',
    '<path fill="COLOR" d="M341 256h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm-298 43h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm-341 85h-43v43h43v-43Zm85 0h-43v43h43v-43Zm85 0h-42v43h42v-43Zm86 0h-43v43h43v-43Zm85 0h-43v43h43v-43Z"/>',
    '<path fill="COLOR" d="M256 341h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-427 43h-43v43h43v-43Zm85 0h-42v43h42v-43Zm86 0h-43v43h43v-43Zm85 0h-43v43h43v-43Zm85 0h-42v43h42v-43Zm86 0h-43v43h43v-43Z"/>',
    '<path fill="COLOR" d="M384 469h-43v43h43v-43Zm43 0h-43v43h43v-43Zm170 0h-42v43h42v-43Zm43 0h-43v43h43v-43Z"/>',
    '<path fill="#fff" d="M427 512h-43v43h43v-43Zm213 0h-43v43h43v-43Z"/>',
    '<path fill="COLOR" d="M341 427h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm86 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm-427 42h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm128 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm128 0h-43v43h43v-43Zm-427 43h-43v43h43v-43Zm85 0h-42v43h42v-43Zm128 0h-42v43h42v-43Zm86 0h-43v43h43v-43Zm128 0h-43v43h43v-43Zm-342 43h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm86 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Z"/>',
    '<path fill="#1F1D2A" d="M683 597h-43v43h43v-43Zm-171 43h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-86 128h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43ZM256 981h-43v43h43v-43Zm128-469h-43v43h43v-43Zm213 0h-42v43h42v-43ZM341 213h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm-256 43h-43v43h43v-43Zm341 0h-43v43h43v-43Zm-384 43h-43v42h43v-42Zm427 0h-43v42h43v-42Zm-470 42h-42v43h42v-43Zm512 0h-42v43h42v-43Zm-512 43h-42v43h42v-43Zm512 0h-42v43h42v-43Zm-469 43h-43v42h43v-42Zm0 128h-43v42h43v-42Zm0 42h-43v43h43v-43Zm0 43h-43v43h43v-43Zm427 0h-43v43h43v-43Zm-427 43h-43v42h43v-42Zm427 0h-43v42h43v-42Zm-427 42h-43v43h43v-43Zm427 0h-43v43h43v-43Zm-427 43h-43v43h43v-43Zm427 0h-43v43h43v-43Zm-427 43h-43v42h43v-42Zm427 0h-43v42h43v-42Zm-427 42h-43v43h43v-43Zm427 0h-43v43h43v-43Zm-427 43h-43v43h43v-43Zm427 0h-43v43h43v-43Zm-427 43h-43v42h43v-42Zm427 0h-43v42h43v-42Zm0 42h-43v43h43v-43Zm-86-768h-42v43h42v-43Z"/>',
    '<path fill="COLOR" d="M299 427h-43v42h43v-42Zm213 0h-43v42h43v-42Zm-213 85h-43v43h43v-43Zm213 0h-43v43h43v-43Zm-213 43h-43v42h43v-42Zm213 0h-43v42h43v-42Zm-213 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-341 43h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm128 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-341 43h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm-341 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-341 43h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm170 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-341 43h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm-341 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-341 43h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-299 43h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm43 0h-43v42h43v-42Zm42 0h-42v42h42v-42Zm43 0h-43v42h43v-42Zm-341 42h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm43 0h-43v43h43v-43Zm42 0h-42v43h42v-43Zm43 0h-43v43h43v-43Zm-341-42h-43v42h43v-42Z"/>',
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


  return `${svgHeader}${svgBody}${farcheck}${svgFooter}`;
}