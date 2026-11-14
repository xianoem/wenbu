import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { RgbaImage } from './Detections'

export const PictureStatus = Schema.Literals(['to-review', 'approved', 'kept'])

export type PictureStatus = typeof PictureStatus.Type

export const Rgb = Schema.Tuple([Schema.Int, Schema.Int, Schema.Int])

export type Rgb = typeof Rgb.Type

export const PictureLine = Schema.Struct({
  id: Schema.Int,
  x: Schema.Int,
  y: Schema.Int,
  w: Schema.Int,
  h: Schema.Int,
  ocr: Schema.String,
  /** The text that is translated: the OCR text, or its correction by the model or the user. */
  source: Schema.String,
  keep: Schema.Boolean,
  fill: Schema.optional(Rgb),
  outline: Schema.optional(Rgb),
  size: Schema.optional(Schema.Int),
  fillBox: Schema.optional(Schema.Boolean),
})

export type PictureLine = typeof PictureLine.Type

/** The boxes a cleaned picture is made from, so a change to them calls for a new one. */
export const cleanKeyOf = (lines: ReadonlyArray<PictureLine>) =>
  lines
    .filter((line) => !line.keep)
    .map((line) => `${line.x},${line.y},${line.w},${line.h}`)
    .join(';')

export const ShownLine = Schema.Struct({
  ...PictureLine.fields,
  translation: Schema.optional(Schema.String),
})

export type ShownLine = typeof ShownLine.Type

export const GamePicture = Schema.Struct({
  /** `folder/name` in lower case without the extension, e.g. `pictures/title`. */
  picture: Schema.String,
  width: Schema.Int,
  height: Schema.Int,
  lines: Schema.Array(ShownLine),
  status: PictureStatus,
  group: Schema.String,
  variants: Schema.Int,
  original: Schema.String,
  cleaned: Schema.optional(Schema.String),
  translated: Schema.optional(Schema.String),
  busy: Schema.optional(Schema.Literals(['translating', 'cleaning'])),
})

export type GamePicture = typeof GamePicture.Type

export const PictureScan = Schema.Struct({ done: Schema.Int, total: Schema.Int })

export type PictureScan = typeof PictureScan.Type

export const PicturesSummary = Schema.Struct({
  /** Grows with every change to the game's pictures, so a list can know to refresh. */
  revision: Schema.Int,
  scanned: Schema.Int,
  withText: Schema.Int,
  approved: Schema.Int,
  kept: Schema.Int,
  translating: Schema.Int,
  canClean: Schema.Boolean,
  scan: Schema.optional(PictureScan),
  notice: Schema.optional(Schema.String),
})

export type PicturesSummary = typeof PicturesSummary.Type

export const PictureStyle = Schema.Struct({ font: Schema.String })

export type PictureStyle = typeof PictureStyle.Type

export const defaultPictureStyle: PictureStyle = { font: 'Segoe UI Semibold' }

export class PicturesError extends Schema.TaggedError<PicturesError>()('PicturesError', {
  reason: Schema.Literals(['not-found', 'not-ready', 'failed']),
  message: Schema.String,
}) {}

const ByGame = { gameId: Schema.String }

const ByPicture = { gameId: Schema.String, picture: Schema.String }

export class PicturesRpc extends RpcGroup.make(
  Rpc.make('watchPictures', { payload: ByGame, success: PicturesSummary, stream: true }),
  Rpc.make('listPictures', { payload: ByGame, success: Schema.Array(GamePicture) }),
  Rpc.make('findPictureText', { payload: ByGame, error: PicturesError }),
  Rpc.make('cancelPictureScan', { payload: ByGame }),
  Rpc.make('translatePictures', {
    payload: { ...ByGame, pictures: Schema.Array(Schema.String) },
    error: PicturesError,
  }),
  Rpc.make('savePictureLine', {
    payload: {
      ...ByPicture,
      line: Schema.Int,
      source: Schema.optional(Schema.String),
      translation: Schema.optional(Schema.String),
      keep: Schema.optional(Schema.Boolean),
      /** `null` goes back to fitting the translation on its own. */
      size: Schema.optional(Schema.NullOr(Schema.Int)),
      fillBox: Schema.optional(Schema.Boolean),
    },
    success: GamePicture,
    error: PicturesError,
  }),
  Rpc.make('addPictureLine', {
    payload: {
      ...ByPicture,
      box: Schema.Struct({ x: Schema.Int, y: Schema.Int, w: Schema.Int, h: Schema.Int }),
      /** The boxed part of the picture, enlarged so OCR can read small text. */
      image: RgbaImage,
    },
    success: GamePicture,
    error: PicturesError,
  }),
  Rpc.make('removePictureLine', {
    payload: { ...ByPicture, line: Schema.Int },
    success: GamePicture,
    error: PicturesError,
  }),
  Rpc.make('cleanPicture', { payload: ByPicture, success: GamePicture, error: PicturesError }),
  Rpc.make('approvePicture', {
    payload: { ...ByPicture, image: Schema.Uint8Array },
    success: GamePicture,
    error: PicturesError,
  }),
  Rpc.make('setPictureStatus', {
    payload: { ...ByPicture, status: Schema.Literals(['to-review', 'kept']) },
    success: GamePicture,
    error: PicturesError,
  }),
  Rpc.make('getPictureStyle', { payload: ByGame, success: PictureStyle }),
  Rpc.make('savePictureStyle', {
    payload: { ...ByGame, style: PictureStyle },
    success: PictureStyle,
  }),
) {}
