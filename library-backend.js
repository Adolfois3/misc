const { ApolloServer } = require('@apollo/server')
// Importaciones para el servidor con Express y WebSockets
const { expressMiddleware } = require('@apollo/server/express4')
const { ApolloServerPluginDrainHttpServer } = require('@apollo/server/plugin/drainHttpServer')
const { makeExecutableSchema } = require('@graphql-tools/schema')
const express = require('express')
const cors = require('cors')
const http = require('http')
const mongoose = require("mongoose")
mongoose.set('strictQuery', false)
const Book = require('./models/modelsBooks')
const Author = require('./models/modelsAuthor')
const { GraphQLError } = require('graphql')
const User = require('./models/user')
const bcryptjs = require('bcryptjs')
const jwt = require("jsonwebtoken")
const { WebSocketServer } = require('ws')
const { useServer } = require('graphql-ws/lib/use/ws')
const {PubSub} = require('graphql-subscriptions')
const pubsub = new PubSub()

require('dotenv').config()

const MONGO_URI = process.env.MONGO_URI

console.log("Conneting to", MONGO_URI)

mongoose.connect(MONGO_URI).then(()=>{
  console.log("Connetc to MONGODB")
}).catch((error)=>{
  console.error("Error connect to MONGODB", error)
})



const typeDefs = `

type Author{
  name:String
  id: ID!
  born: Int 
}
  type User{
  username:String!,
  favoriteGenre:String
  id:ID!
  }

type Book{
  title:String!
  published: Int!
  author: Author!
  id: ID!
  genres: [String!]
}
  type Token{
  value:String!
  }

  type Subscription{
  bookAdded:Book!
  }

type Query {
  bookCount: Int!
  authorCount: Int!
  allAuthor: [Author!]!
  allBooks(genre: String): [Book!]!
  me:User
}

type Mutation{
createUser(
username:String!,
password: String!
):User

login(
username:String!
password:String!
):Token



addBook(
  title:String!
  published: Int!
  author:String!
  genres: [String!]
):Book!

addBorn(
  name:String!
  setBorn:Int!
):Author!

editFavoriteGenre(
  genre: String!
): User
}
`

const resolvers = {

  Book:{
    author:async(root)=>{
      return Author.findById(root.author)
    }
  },
  Query: {
    bookCount: async () => Book.collection.countDocuments(),
    authorCount: async ()=> Author.collection.countDocuments(),
    me: async(root, args,context)=> {
      return context.currentUser
    },

    allAuthor: async (root, args) => {
      return Author.find({})
    },
    allBooks: async (root, args) => {
      if (args.genre) {
        // Si se proporciona un género, filtra los libros que lo incluyan en su array de géneros.
        return Book.find({ genres: { $in: [args.genre] } }).populate('author')
      }
      return Book.find({}).populate('author')
    },
  },

  Mutation:{
    createUser: async (root, args) => {
      try{
        const saltRounds = 10
        const passwordHash = await bcryptjs.hash(args.password, saltRounds)

        const user = new User({ username: args.username, passwordHash })

      return user.save()
      }catch(error){
        throw new  GraphQLError("Creating user error",{
          extensions:{
            code: 'BAD_USER_INPUT', 
            invalidArgs: args.username,
            error
          }
        })
      }
    },
    login: async (root, args) => {
      const user = await User.findOne({ username: args.username })

      const passwordCorrect = user === null
        ? false
        : await bcryptjs.compare(args.password, user.passwordHash)

      if (!(user && passwordCorrect)) {
                throw new  GraphQLError("error credentials",{
          extensions:{
            code: 'BAD_USER_INPUT',
          }
        })
      }
      const userForToken={
        username: user.username,
        id:user._id.toString()
      }

      return {value: jwt.sign(userForToken, process.env.JWT_SECRET,{expiresIn: 60*60})}
    },



    addBook: async (root, args,context)=>{

      const currentUser = context.currentUser
      if(!currentUser){
        throw new GraphQLError("No autenticado",{extensions:{code:'FORBIDEN'}})
      }
      let author = await Author.findOne({name:args.author})
      if(!author){
        author = new Author({name: args.author})
      }
      try{
        await author.save()
      }catch(error){
        throw new GraphQLError(`Error saving author: ${error.message}`, {
          extensions: {
            code: 'BAD_USER_INPUT',
            invalidArgs: args.author,
            error
          }
        })
      }
      const newBook = new Book({
        title: args.title,
        published: args.published,
        author: author._id, 
        genres: args.genres
      })
      try{
      const savedBook = await newBook.save()
        const populatedBook = await savedBook.populate('author')
        pubsub.publish('BOOK_ADDED', { bookAdded: populatedBook })
        return populatedBook
      }catch(error){
        throw new GraphQLError("Saving book failed",{
          extensions:{
            code: 'BAD_USER_INPUT',
            invalidArgs: args.title,
            error
          }
        })
      }

    },
    
    addBorn: async (root, {name, setBorn}, context)=>{

      const currentUser = context.currentUser
            if(!currentUser){
        throw new GraphQLError("No autenticado",{extensions:{code:'FORBIDEN'}})
      }

      const author = await Author.findOne({name})
      if(!author){
        throw new Error(`Autor con nombre ${name} no encontrado.`)
      }
      author.born = setBorn

      try{
        return author.save()
      }catch(error){
        throw new GraphQLError("Edit born failed",{
          extensions:{
              code: 'BAD_USER_INPUT',
            invalidArgs: name,
            error
          }
        })
      }
    },

    editFavoriteGenre: async (root, args, context) => {
      const currentUser = context.currentUser
      if (!currentUser) {
        throw new GraphQLError("No autenticado", { extensions: { code: 'FORBIDEN' } })
      }

      const user = await User.findById(currentUser.id)
      user.favoriteGenre = args.genre
      try {
        await user.save()
        return user
      } catch (error) {
        throw new GraphQLError("Failed to set favorite genre", {
          extensions: { code: 'BAD_USER_INPUT', error }
        })
      }
    }
  },
  // El resolver de Subscription debe estar al mismo nivel que Query y Mutation
  Subscription: {
    bookAdded: {
      subscribe: () => pubsub.asyncIterator(['BOOK_ADDED'])
    }
  }
}

const start = async () => {
  const app = express()
  const httpServer = http.createServer(app)

  const schema = makeExecutableSchema({ typeDefs, resolvers })

  // Configuración del servidor WebSocket
  const wsServer = new WebSocketServer({
    server: httpServer,
    path: '/',
  })

  const serverCleanup = useServer({ schema }, wsServer)

  // Configuración del servidor Apollo
  const server = new ApolloServer({
    schema,
    introspection: true,
    plugins: [
      // Plugin para cerrar correctamente el servidor HTTP
      ApolloServerPluginDrainHttpServer({ httpServer }),
      // Plugin para cerrar correctamente el servidor WebSocket
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          };
        },
      },
    ],
  })

  await server.start()

  // Middleware para las peticiones GraphQL sobre HTTP
  app.use(
    '/',
    cors(),
    express.json(),
    expressMiddleware(server, {
      context: async ({ req }) => {
        const auth = req ? req.headers.authorization : null
        if (auth && auth.startsWith('Bearer ')) {
          try {
            const decodedToken = jwt.verify(auth.substring(7), process.env.JWT_SECRET)
            const currentUser = await User.findById(decodedToken.id)
            return { currentUser }
          } catch (error) {
            console.log('Error al verificar el token:', error.message)
          }
        }
        return {}
      },
    }),
  )

  const PORT = 4000
  httpServer.listen(PORT, () =>
    console.log(`🚀 Server ready at http://localhost:${PORT}`)
  )
}

start()
