"""Fehlerarten. Alle Meldungen sind deutsch und für Menschen lesbar."""


class FabError(Exception):
    """Ein Bedienfehler: das CLI meldet ihn auf stderr und endet mit Exit 1."""


class HcError(FabError):
    """herdr-core (`hc`) antwortet nicht oder mit einem Fehler."""
