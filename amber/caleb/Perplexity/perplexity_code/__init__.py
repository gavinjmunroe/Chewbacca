from importlib.metadata import version, PackageNotFoundError

try:
    __version__ = version("perplexity-code")
except PackageNotFoundError:
    __version__ = "0.7.1"

__all__ = ["__version__"]
