import { Fragment } from "react";

const AMOUNT = /(-?₪[\d,]+(?:\.\d+)?)/;

/**
 * Message text with every shekel amount isolated as left-to-right, so the sign
 * stays in front of the digits inside a Hebrew sentence.
 */
export function BotText({ text }: { text: string }) {
  return (
    <>
      {text.split(AMOUNT).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="num font-semibold">
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
