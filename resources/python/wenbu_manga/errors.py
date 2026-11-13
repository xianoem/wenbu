def describe(error: BaseException) -> str:
    if type(error).__name__ == "OutOfMemoryError":
        return "The GPU ran out of memory. Lower the detection or inpainting size, or pages ahead."

    message = str(error).strip()

    return f"{type(error).__name__}: {message}" if message else type(error).__name__
