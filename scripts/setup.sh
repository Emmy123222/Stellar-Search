#!/bin/bash
echo "Setting up Stellar-Search dev environment..."

# Check Node version
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js."
    exit 1
fi
node_version=$(node -v)
echo "Node version: $node_version"

# Run npm install
echo "Installing dependencies..."
npm install

# Copy .env.example
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "Copied .env.example to .env"
    else
        echo ".env.example not found. Creating empty .env"
        touch .env
    fi
else
    echo ".env already exists, skipping copy."
fi

echo "Setup complete! Next steps:"
echo "1. Open .env and fill in the required keys."
echo "2. Run 'npm run config:check' to validate the configuration (values are never printed)."
echo "3. Run 'npm run dev:all' to start both frontend and backend."
