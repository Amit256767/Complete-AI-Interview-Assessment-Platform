import { PrismaClient } from '@prisma/client';
const prisma=new PrismaClient();
const questions=[
['What is a closure in JavaScript?','JavaScript','BEGINNER',['A function bundled with its lexical environment','A method that closes a browser tab','A loop control statement','A type of promise'],0,'A closure retains access to variables from its lexical scope.'],
['Which hook is intended for side effects in a React function component?','React','BEGINNER',['useEffect','useState','useMemo','useRef'],0,'useEffect handles side effects such as subscriptions and data fetching.'],
['What does an HTTP 201 response indicate?','REST APIs','BEGINNER',['Resource created','Request accepted but not completed','No content returned','Unauthorized request'],0,'201 Created indicates that a request created a resource.'],
['Which SQL clause filters grouped rows?','SQL and PostgreSQL','INTERMEDIATE',['HAVING','WHERE','ORDER BY','LIMIT'],0,'HAVING filters the results after GROUP BY.'],
['Why use a database index?','SQL and PostgreSQL','INTERMEDIATE',['To speed up lookups at a storage cost','To encrypt a table','To prevent all duplicate rows','To create a transaction'],0,'Indexes can improve query reads, with storage and write overhead.'],
['Which Node.js mechanism handles asynchronous I/O efficiently?','Node.js and Express','INTERMEDIATE',['Event loop','One thread per request','Polling every database row','Synchronous filesystem calls'],0,'The event loop coordinates non-blocking I/O.'],
['What is the average lookup complexity of a hash table?','Data Structures and Algorithms','INTERMEDIATE',['O(1)','O(log n)','O(n)','O(n log n)'],0,'Average-case lookup is constant time with a suitable hash distribution.'],
['What should an API return when a client lacks valid authentication?','REST APIs','BEGINNER',['401 Unauthorized','200 OK','404 Not Found','301 Moved Permanently'],0,'401 indicates missing or invalid authentication credentials.']
];
await prisma.question.createMany({data:questions.map(([prompt,category,difficulty,options,answerIndex,explanation])=>({prompt:prompt as string,category:category as string,difficulty:difficulty as string,type:'MCQ',options:options as string[],answerIndex:answerIndex as number,explanation:explanation as string}))});await prisma.$disconnect();
