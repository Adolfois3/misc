const { ApolloServer } = require('@apollo/server')
const { startStandaloneServer } = require('@apollo/server/standalone')
const mongoose = require("mongoose")
mongoose.set('strictQuery', false)
const Book = require('./models/modelsBooks')
const Author = require('./models/modelsAuthor')
const { GraphQLError } = require('graphql')
const User = require('./models/user')
const bcryptjs = require('bcryptjs')
const jwt = require("jsonwebtoken")

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
  favoriteGenre:[ID]
  id:ID!
  }

type Book{
  title:String!
  published: Int!
  author:Author!
  id: ID!
  genres: [String!]
}
  type Token{
  value:String!
  }

type Query {
  bookCount: Int!
  authorCount: Int!
  allAuthor: [Author!]! 
  allBooks: [Book!]! 
  me:User
}

type Mutation{
createUser(
username:String!
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
    allBooks: async (root,args)=>{
      return Book.find({})
    },
  },

  Mutation:{
    createUser: async(root, args)=>{
      try{
      const user =  new User({username: args.username})
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
    login: async(root, args)=>{
      const user = await User.findOne({username:args.username})
      if(!user || args.password !== 'secret'){
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
        throw new GraphQLError(error,{
            code: 'BAD_USER_INPUT',
            invalidArgs: args.name,
            error
        })
      }
      const newBook = new Book({
        title: args.title,
        published: args.published,
        author: author._id, 
        genres: args.genres
      })
      try{
        await newBook.save()
        return newBook.populate('author')
      }catch(error){
        throw new GraphQLError("Saving book failed",{
          extensions:{
            code: 'BAD_USER_INPUT',
            invalidArgs: args.name,
            error
          }
        })
      }
      
    },

    addBorn: async (root, {name, setBorn}, context)=>{

      const currentUser = context.currentUser
      if(currentUser){
        console.log("Persona encontrada", currentUser)
      }
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
    }
  }
}

const server = new ApolloServer({
  typeDefs,
  resolvers,
})




startStandaloneServer(server, {
  listen: { port: 4000 },

  context: async({req, res})=>{
       const auth = req ? req.headers.authorization : null
       console.log("--- SOLICITUD RECIBIDA ---");

       console.log("Header Auth:", auth);

       let currentUser = null
    if (auth && auth.startsWith('Bearer ')) {
      try{
        const decodedToken = jwt.verify(auth.substring(7), process.env.JWT_SECRET)
        console.log("Token decodificado:", decodedToken)
      currentUser = await User.findById(decodedToken.id)
      console.log("Usuario encontrado:", currentUser ? currentUser.username : "NULO")
    }catch(error){
      throw new GraphQLError(`Error de verificación JWT: ${error.message}`, { 
          extensions: {
            code: 'UNAUTHORIZED',
            originalErrorName: error.name // Esto es clave
          }
        })
    }
    }
    return { currentUser }
  }
}).then(({ url }) => {
  console.log(`Server ready at ${url}`)
})
