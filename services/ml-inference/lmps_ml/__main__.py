import os
import sys

import uvicorn

from .app import create_app
from .config import read_config


def main() -> None:
    try:
        port = read_config(os.environ)
        app = create_app()
    except ValueError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None

    uvicorn.run(app, host="127.0.0.1", port=port, access_log=False, proxy_headers=False)


if __name__ == "__main__":
    main()
