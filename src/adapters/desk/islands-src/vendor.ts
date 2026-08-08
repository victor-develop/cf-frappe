/**
 * Vendor anchor entry.
 *
 * Imports exactly the React modules islands are allowed to share. Because
 * this file is built as its own entry alongside every island entry (esbuild
 * `splitting: true`), the React runtime is extracted into a shared chunk
 * that all islands reference — even when only one island exists — so React
 * downloads once and stays cache-stable across island releases.
 */
import "react";
import "react/jsx-runtime";
import "react-dom/client";

export {};
