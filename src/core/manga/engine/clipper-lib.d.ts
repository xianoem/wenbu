declare module 'clipper-lib' {
  interface IntPoint {
    X: number
    Y: number
  }

  interface ClipperOffset {
    AddPath(path: Array<IntPoint>, joinType: number, endType: number): void
    Execute(solution: Array<Array<IntPoint>>, delta: number): void
  }

  const ClipperLib: {
    ClipperOffset: new (miterLimit?: number, arcTolerance?: number) => ClipperOffset
    JoinType: { readonly jtRound: number }
    EndType: { readonly etClosedPolygon: number }
  }

  export default ClipperLib
}
