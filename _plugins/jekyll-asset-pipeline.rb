require 'jekyll_asset_pipeline'

# Additions to jekyll-asset-pipeline
module JekyllAssetPipeline

	# Compile LESS to CSS
	class LESSConverter < JekyllAssetPipeline::Converter

		# Dependencies
		require 'shellwords'

		# What filetypes we're interested in
		def self.filetype
			'.less'
		end

		# Function to convert input at @content to output via return
		def convert

			# Build a shell command to convert via lessc
			# echo "less content" | lessc -
			command = [
				"echo",
				Shellwords.escape(@content),
				"|",
				"lessc",
				"-x",
				"-O2",
				"-"
			].join(" ")

			# Execute the command and return stdout data
			return `#{command}`
		end

	end

	# Compress JavaScript
	class JavaScriptCompressor < JekyllAssetPipeline::Compressor
		require 'closure-compiler'

		def self.filetype
			'.js'
		end

		def compress
			return Closure::Compiler.new.compile(@content)
		end
	end
end

