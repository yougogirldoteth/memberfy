import {
  FrameButton,
  FrameContainer,
  FrameImage,
  FrameInput,
  FrameReducer,
  getPreviousFrame,
  useFramesReducer,
  validateActionSignature,
} from "frames.js/next/server";
import Link from "next/link";
import { generateImage } from "./generate-image";
import { redirect } from "next/dist/server/api-utils";

type State = {
  active: string;
  total_button_presses: number;
};

const initialState = { active: "1", total_button_presses: 0 };

const reducer: FrameReducer<State> = (state, action) => {
  return {
    total_button_presses: state.total_button_presses + 1,
    active: action.postBody?.untrustedData.buttonIndex
      ? String(action.postBody?.untrustedData.buttonIndex)
      : "1",
  };
};

// This is a react server component only
export default async function Home({
  searchParams,
}: {
  searchParams: Record<string, string>;
}) {
  const previousFrame = getPreviousFrame<State>(searchParams);

  const validMessage = await validateActionSignature(previousFrame.postBody);

  const [state, dispatch] = useFramesReducer<State>(
    reducer,
    initialState,
    previousFrame
  );

  // Here: do a server side side effect either sync or async (using await), such as minting an NFT if you want.
  // example: load the users credentials & check they have an NFT
  const encodedPngImage = await generateImage(validMessage!);

  console.log(state);

  const fallbackImageUrl = 'https://memberfy.vercel.app/member.png';
  const fid = validMessage?.data.fid;

  // then, when done, return next frames
  return (
    <div>
      Memberfy your PFP built by yougogirl.eth
      <FrameContainer
        postUrl="/frames"
        state={state}
        previousFrame={previousFrame}
      >
        <FrameImage aspectRatio="1:1"
          src={encodedPngImage ? `data:image/png;base64,${encodedPngImage}` : fallbackImageUrl}
        />
        <FrameButton onClick={dispatch}>
          {"Memberfy your PFP"}
        </FrameButton>
        <FrameButton href={encodedPngImage ? `https://memberfy.vercel.app/api/custom_member/${fid}` : fallbackImageUrl}>Download Member</FrameButton>
      </FrameContainer>
    </div>
  );
}
