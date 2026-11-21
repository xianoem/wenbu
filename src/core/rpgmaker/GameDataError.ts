import { Schema } from 'effect'

export class GameDataError extends Schema.TaggedError<GameDataError>()('GameDataError', {
  message: Schema.String,
}) {}
