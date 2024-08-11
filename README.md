Installation and Running Guide

1. Clone the Repository:
   ```bash
   git clone <repository-url>
   cd <repository-folder>
   ```

2. Install Dependencies:
   Ensure you have Node.js installed. Then, install the required packages by running:
   ```bash
   npm install dotenv express multer fs pdf-parse googleapis @google/generative-ai pdfkit
   ```

3. Set Up Environment Variables:
   - Create a `.env` file in the root directory.
   - Add your API keys for Google Generative AI and YouTube Data API:
     ```
     API_KEY=your_google_generative_ai_api_key
     YOUTUBE_API_KEY=your_youtube_data_api_key
     PORT=3000
     ```

4. Start the Server:
   Run the server using:
   ```bash
   node server.js
   ```

5. Access the Application:
   Open your browser and navigate to `http://localhost:3000` to start using the application.

6. Usage:
   - Upload a PDF or other media files to extract content and generate quizzes, notes, or insights.
   - Use the `/generate-pdf` endpoint to create a downloadable PDF from text.
   - The server uses Google Generative AI to generate content based on the extracted or inputted text.
