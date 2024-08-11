require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const pdf = require('pdf-parse');
const { google } = require('googleapis');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const PDFDocument = require('pdfkit');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const genAI = new GoogleGenerativeAI(process.env.API_KEY);
const fileManager = new GoogleAIFileManager(process.env.API_KEY);
const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

function formatText(text) {
    let formattedText = text.replace(/\*(.*?)\*/g, '<b>$1</b>');
    formattedText = formattedText.replace(/\n/g, '<br>');
    formattedText = formattedText.replace(/(?:^|[\n\r])(\* )/g, '<br>$1');
    return formattedText;
}

function cleanText(text) {
    return text.replace(/[^\w\s.,?!-]/g, '').replace(/\s+/g, ' ').trim();
}

async function searchYouTube(query) {
    try {
        console.log('Searching YouTube for:', query);
        const response = await youtube.search.list({
            part: 'snippet',
            q: query,
            maxResults: 4,
            type: 'video',
            relevanceLanguage: 'en',
            videoEmbeddable: true,
            videoCategoryId: '27',
            order: 'relevance'
        });
        const videoIds = response.data.items.map(item => item.id.videoId).join(',');
        const statsResponse = await youtube.videos.list({
            part: 'statistics',
            id: videoIds
        });

        const filteredVideos = response.data.items.filter((item, index) => {
            const stats = statsResponse.data.items[index].statistics;
            return parseInt(stats.viewCount) > 1000 && 
                (parseInt(stats.likeCount) / parseInt(stats.viewCount)) > 0.01;
        });

        const videos = filteredVideos.map(item => `https://www.youtube.com/embed/${item.id.videoId}`);
        console.log('YouTube search response:', videos);
        return videos;
    } catch (error) {
        console.error('YouTube search error:', error);
        throw error;
    }
}
app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file && !req.body.userInput) {
        return res.status(400).json({ success: false, error: 'No file or input provided.' });
    }

    const option = req.body.option;
    const quizSize = req.body.quizSize || 5;  // Default to 5 if not provided
    if (!option) {
        return res.status(400).json({ success: false, error: 'No option selected.' });
    }

    let extractedText = '';
    let prompt;
    let fileMimeType = '';
    let fileUri = '';
    let userInput = req.body.userInput ? req.body.userInput.trim() : '';

    if (req.file) {
        try {
            const filePath = req.file.path;
            const fileBuffer = fs.readFileSync(filePath);
            const mimeType = req.file.mimetype;

            if (mimeType === 'application/pdf') {
                const data = await pdf(fileBuffer);
                extractedText = data.text;
            } else if (mimeType.startsWith('image/') || mimeType.startsWith('audio/') || mimeType.startsWith('video/')) {
                const uploadResult = await fileManager.uploadFile(filePath, {
                    mimeType,
                    displayName: req.file.originalname,
                });
                fileUri = uploadResult.file.uri;
                fileMimeType = mimeType;
            }
            fs.unlinkSync(filePath);
        } catch (error) {
            console.error('Error processing file:', error);
            return res.status(500).json({ success: false, error: 'Error processing file.' });
        }
    } else {
        extractedText = userInput;
    }

    // Prepend the additional input to the extracted text
    if (userInput) {
        extractedText = `Additional Input:\n\n${userInput}\n\n` + extractedText;
    }

    extractedText = cleanText(extractedText);

    if (option === 'quiz') {
        prompt = `Create a quiz with ${quizSize} questions based on the following text and give the answer key at the end. For each question, provide:\n\nText: ${extractedText}`;
    } else if (option === 'notes') {
        prompt = `Generate concise notes (summarizing the key points from the following text) or (write notes for this topic):\n\n${extractedText}`;
    } else if (option === 'teach') {
        prompt = `Act like a teacher and provide key insights and explain about this topic, including solving methods. Provide the full concept, and if possible, one question as an example:\n\n${extractedText}`;
    } else {
        prompt = `Analyze the following text and provide key insights:\n\n${extractedText}`;
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const generateParams = fileUri ? [
            {
                fileData: {
                    mimeType: fileMimeType,
                    fileUri: fileUri
                }
            },
            { text: prompt }
        ] : prompt;

        const result = await model.generateContent(generateParams);
        const response = await result.response;
        let geminiOutput = await response.text();

        if (option === 'quiz') {
            try {
                const quizData = JSON.parse(geminiOutput);
                res.json({ success: true, quizData: quizData, processedText: geminiOutput });
            } catch (jsonError) {
                console.error('Error parsing JSON:', jsonError);
                const htmlOutput = formatText(geminiOutput);
                res.json({ success: true, output: htmlOutput, fallback: true, processedText: geminiOutput });
            }
        } else if (option === 'teach') {
            const summary = geminiOutput.trim();
            const promptForYouTube = `Summarize this full text into only one line so I can use it for YouTube search (up to 10 words):\n\n${summary}`;
            const searchResult = await model.generateContent(promptForYouTube);
            const searchQuery = await searchResult.response.text();
            const videoUrls = await searchYouTube(searchQuery.trim());
            const htmlOutput = formatText(geminiOutput);
            res.json({ success: true, output: htmlOutput, videoUrls: videoUrls, processedText: geminiOutput });
        } else {
            const htmlOutput = formatText(geminiOutput);
            res.json({ success: true, output: htmlOutput, processedText: geminiOutput });
        }
    } catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});


app.post('/generate-pdf', (req, res) => {
    const text = req.body.text;

    const doc = new PDFDocument();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="output.pdf"');

    doc.pipe(res);

    doc.text(text, { encoding: 'utf8' });

    doc.end();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
