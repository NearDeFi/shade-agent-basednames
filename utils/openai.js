import OpenAI from 'openai';
const openai = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENAI_KEY,
});

export async function genMetadata(tweetText, tweetImage) {
    try {
        const systemPrompt =
            'Choose a cryptocurrency token name and symbol that reflect the text (and optional image) from a tweet submitted by the user prompt. Use a unique word or phrase that appears in the tweet for the name, consider the image content, when available, if there is not enough text in the tweet. Create an abbreviation for the symbol (or whole word if short enough), max length 3-4 characters and uppercase. Output in JSON: {name: <name>, symbol: <symbol>}';

        const completion = await openai.chat.completions.create({
            model: 'openai/o4-mini',
            messages: [
                {
                    role: 'system',
                    content: systemPrompt,
                },
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: tweetText,
                        },
                        tweetImage
                            ? {
                                  type: 'image_url',
                                  image_url: {
                                      url: tweetImage,
                                  },
                              }
                            : undefined,
                    ],
                },
            ],
        });

        const response = completion.choices[0].message.content
            .replaceAll('```json', '')
            .replaceAll('`', '')
            .replaceAll('\n', '');

        return JSON.parse(response);
    } catch (e) {
        console.log('LLM error', e);
        // the caller is expecting to deconstruct name, symbol
        return {};
    }
}
